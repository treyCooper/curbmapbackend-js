/* "use strict"; */
const fs = require("fs");
const atob = require("atob");
const geolib = require("geolib");
const express = require("express");
const router = express.Router();
const ensureLoggedIn = require("connect-ensure-login").ensureLoggedIn;
const mongooseModels = require("../model/mongooseModels.js");
const postgres = require("../model/postgresModels");
const OpenLocationCode = require("open-location-code").OpenLocationCode;
const openLocationCode = new OpenLocationCode();
const isNull = require("util").isNull;
const uuidv1 = require("uuid/v1");
const twilio = require("twilio");
const sharp = require("sharp");
const apn = require("apn"); // for apple notification
const twilclient = new twilio(process.env.TWILIOSID, process.env.TWILIOAUTH); // for twilio messaging
const onCallList = process.env.ONCALLLIST.split(",");
const levels = {
  sandbox: [
    "ROLE_SANDBOX",
    "ROLE_TEST",
    "ROLE_USER",
    "ROLE_ADMIN",
    "ROLE_OWNER"
  ],
  test: ["ROLE_TEST", "ROLE_USER", "ROLE_ADMIN", "ROLE_OWNER"],
  user: ["ROLE_USER", "ROLE_ADMIN", "ROLE_OWNER"],
  admin: ["ROLE_ADMIN", "ROLE_OWNER"],
  owner: ["ROLE_OWNER"]
};
const maxSize = 20 * 1000 * 1000;
const multer = require("multer");

var storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function(req, file, cb) {
    cb(null, req.user.id + "-" + Date.now());
  }
});

const upload = multer({
  limits: {
    fileSize: maxSize
  },
  storage: storage
});

let apnOptions = {
  token: {
    key: "../apn_cert.p8",
    keyId: "N36MRYQ382",
    teamId: "CNKFCAS44G"
  }
};
let apnProvider = new apn.Provider(apnOptions);

const passport = require("passport");
const winston = require("winston");
const MessagingResponse = require("twilio").twiml.MessagingResponse;
let HOST_RES = "https://curbmap.com:50003/";
let HOST_AUTH = "https://curbmap.com/";
if (process.env.ENVIRONMENT === "TEST") {
  HOST_RES = "https://27e0c8fb.ngrok.io/";
  HOST_AUTH = "https://6b890315.ngrok.io/";
}
router.get("/uploads/:name", async function(req, res, next) {
  var options = {
    root: __dirname + "/../uploads/",
    dotfiles: "deny",
    headers: {
      "x-timestamp": Date.now(),
      "x-sent": true
    }
  };
  var fileName = req.params.name;
  if (fileName.includes("-text.jpg")) {
    res.sendFile(fileName, options, function(err) {
      if (err) {
        res.status(404).json({
          error: "no file"
        });
      } else {
        winston.log("info", "Sent:", fileName);
      }
    });
  } else if (fileName.includes("jpg")) {
    sharp(fileName)
      .rotate()
      .resize(800)
      .toBuffer()
      .then(fileBuffer => {
        return res.status(200).json({
          success: true,
          image: "data:image/jpeg;base64," + fileBuffer.toString("base64")
        });
      })
      .catch(err => {
        return res.status(500).json({ error: "No file or error" });
      });
  } else if (fileName.includes("bz2")) {
    // the bz2 files
    res.sendFile(fileName, options, function(err) {
      if (err) {
        res.status(404).json({
          error: "no file"
        });
      } else {
        winston.log("info", "Sent:", fileName);
      }
    });
  }
});
router.post(
  "/postRects",
  passport.authenticate("jwt", { session: false }),
  async function(req, res, next) {
    if (findExists(req.user.role, levels.user)) {
      try {
        let photo = await mongooseModels.photos.findOne({
          _id: mongooseModels.obj_id(req.body.id)
        });
        photo.classifications.push({
          userid: req.user.id,
          type: 0,
          boxes: constructBoxesFrom(req.body.boxes),
          content: [],
          date: new Date()
        });
        await photo.save();
        res.status(200).json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false });
      }
    } else {
      return res.status(200).json({
        success: true,
        comment:
          "Normally, out of the sandbox you would have been able to add data for bounding boxes and labels."
      });
    }
  }
);
router.post(
  "/getPhoto",
  passport.authenticate("jwt", { session: false }),
  async function(req, res, next) {
    if (findExists(req.user.role, levels.user)) {
      try {
        let avail = await mongooseModels.photos.aggregate([
          {
            $match: { "classifications.userid": { $nin: [req.user.id] } }
          }
        ]);
        if (avail.length === 0) {
          res.status(200).json({ success: false, error: "no more photos" });
        } else {
          winston.log("error", "avail", avail.length);
          let randomImage = Math.round(Math.random() * avail.length);
          let i = 0;
          while (
            randomImage >= avail.length ||
            !fs.existsSync(__dirname + "/../" + avail[randomImage].filename)
          ) {
            if (i >= 5) {
              return res
                .status(200)
                .json({ success: false, error: "no more photos" });
            }
            winston.log("error", __dirname, randomImage, avail[randomImage]);
            if (randomImage < avail.length) {
              // remove the image from the DB and from the aggregation with slice
              let removed = await mongooseModels.photos.remove({
                _id: avail[randomImage]._id
              });
              avail.splice(randomImage, 1);
              winston.log("info", "removed", removed);
            }
            // pick a new number, hopefully from the values we actually have in the list
            randomImage = Math.round(Math.random() * avail.length);
            winston.log("info", "random image", randomImage);
            i += 1;
          }
          sharp(__dirname + "/../" + avail[randomImage].filename)
            .rotate()
            .resize(800)
            .toBuffer()
            .then(fileBuffer => {
              let id = avail[randomImage]._id.toString();
              return res.status(200).json({
                success: true,
                image:
                  "data:image/jpeg;base64," + fileBuffer.toString("base64"),
                id: id
              });
            })
            .catch(err => {
              return res.status(500).json({ error: "No file or error" });
            });
        }
      } catch (error) {
        winston.log("error", "oops error for userid:", req.user.id, error);
      }
    } else {
      if (req.user.role === "ROLE_SANDBOX") {
        return res.status(200).json({
          success: true,
          image: "image bas64 string",
          id: "imageid",
          comment: "You would normally be returned an image"
        });
      }
    }
  }
);

router.post(
  "/addClassification",
  passport.authenticate("jwt", { session: false }),
  async function(req, res, next) {
    try {
      if (req.body.boxes === undefined || req.body.boxes.length == 0) {
        res
          .status(400)
          .json({ success: false, error: "Boxes must be defined" });
        return next();
      }
    } catch (error) {}
  }
);

function completeSend(buffer) {}

router.post(
  "/addLine",
  passport.authenticate("jwt", { session: false }),
  async function(req, res, next) {
    if (
      typeof req.body.line !== "object" ||
      req.body.line.length < 2 || // start & end points must exist for line to exist
      typeof req.body.restrictions !== "object" ||
      req.body.restrictions.length == 0
    ) {
      res.status(400).json({
        success: false
      });
    } else {
      try {
        if (
          findExists(req.user.role, levels.test) &&
          (req.body.parentid === undefined ||
            !mongooseModels.obj_id.isValid(req.body.parentid))
        ) {
          // this type does not get added to a parent line, so it is parentless and gets
          // added to the Lines collection which hasn't had
          let new_line = new mongooseModels.linesWithoutParents({
            loc: {
              type: "LineString",
              coordinates: req.body.line
            },
            restrs: [],
            restrs_length: 0
          });
          for (var restr of req.body.restrictions) {
            if (checkRestr(restr)) {
              restr_checked = {
                tp: restr.type,
                an: restr.angle,
                st: restr.start,
                ds: restr.days,
                wk: restr.weeks,
                mn: restr.months,
                lt: restr.limit,
                ed: restr.end,
                pm: restr.permit,
                ct: restr.cost,
                pr: restr.per,
                ve: restr.vehicle,
                sd: restr.side,
                up: 0,
                dn: 0,
                by: req.user.id,
                ud: new Date()
              };
              new_line.restrs.push(restr_checked);
              new_line.restrs_length++;
            }
          }
          winston.log("info", new_line);
          if (new_line.restrs.length > 0) {
            await new_line.save();
            res.status(200).json({
              success: true,
              line_id: new_line._id.toString()
            });
            for (restr of new_line.restrs) {
              postgres.addToLines(
                {
                  line_coords: new_line.loc.coordinates,
                  line_id: new_line._id,
                  restr_id: restr._id,
                  date: Date()
                },
                req.user.id
              );
            }
          } else {
            res.status(200).json({
              success: false
            });
          }
        } else if (findExists(req.user.role, levels.test)){
          let parent_id = mongooseModels.obj_id(req.body.parentid);

          let parent = await mongooseModels.parents
            .findOne({
              _id: parent_id
            })
            .exec();
          if (parent !== null) {
            parent.lines.push({
              loc: {
                type: "LineString",
                coordinates: req.body.line
              },
              restrs_length: 0,
              restrs: []
            });
            parent.lines_length += 1;
            let new_length = parent.lines_length;
            let checked_restrs = [];
            for (let restr of req.body.restrictions) {
              if (checkRestr(restr)) {
                restr_checked = {
                  tp: restr.type,
                  an: restr.angle,
                  st: restr.start,
                  ed: restr.end,
                  ds: restr.days,
                  wk: restr.weeks,
                  mn: restr.months,
                  lt: restr.limit,
                  pm: restr.permit,
                  ct: restr.cost,
                  pr: restr.per,
                  ve: restr.vehicle,
                  sd: restr.side,
                  up: 0,
                  dn: 0,
                  by: req.user.id,
                  ud: new Date()
                };
                parent.lines[new_length - 1].restrs.push(restr_checked);
                parent.lines[new_length - 1].restrs_length += 1;
                parent.total_types += 1;
                new_parent_types = parent.types_each;
                new_parent_types[restr["type"]] += 1;
                parent.types_each = new_parent_types; // to mark as modified
                parent.markModified("types_each");
              }
            }
            // Went through all new restrictions... now test if any were correct and added
            if (parent.lines[new_length - 1].restrs.length > 0) {
              // If the new line has some restrictions, add it, otherwise, don't
              await parent.save();
              res.status(200).json({
                success: true,
                line_id: parent.lines[new_length - 1]._id.toString()
              });
              for (restr of parent.lines[new_length - 1]) {
                postgres.addToLines(
                  {
                    parent_id: parent._id,
                    line_coords: parent.lines[new_length - 1].loc.coordinates,
                    line_id: parent.lines[new_length - 1]._id,
                    restr_id: restr._id,
                    date: Date()
                  },
                  req.user.id
                );
              }
            } else {
              // we didn't add any new restrictions to the new line, so don't save it to the
              // parent line
              res.status(200).json({
                success: false
              });
            }
          }
        } else {
          return res.status(200).json({success: 200, comment: "If you were a user or on the app you could add lines! Come join us."})
        }
      } catch (error) {
        winston.log("warn", error);
      }
    }
  }
);

router.post(
  "/upVote",
  passport.authenticate("jwt", { session: false }),
  function(req, res, next) {
    if (findExists(req.user.role, levels.user)) {
      return next();
    } else {
      return res.status(200).json({
        success: true,
        comment:
          "As a testing user we are unable to calculate statistics for the value of a downvote"
      });
    }
    // TODO: MUST WRITE up Voting of restriction
  }
);
router.post(
  "/downVote",
  passport.authenticate("jwt", { session: false }),
  function(req, res, next) {
    if (findExists(req.user.role, levels.user)) {
      winston.log("info", "downVote", {
        body: req.body,
        headers: req.header
      });
      // TODO: MUST WRITE Down Voting of restriction
    } else {
      res.status(200).json({
        success: true,
        comment:
          "As a testing user we are unable to calculate statistics for the value of a downvote"
      });
    }
  }
);

router.post(
  "/addLineRestr",
  passport.authenticate("jwt", { session: false }),
  async function(req, res, next) {
    if (
      findExists(req.user.role, levels.test) &&
      req.body.lineid !== undefined &&
      mongooseModels.obj_id.isValid(req.body.lineid)
    ) {
      // Whether the line has a parent or not, we must be able to find the line that
      // the restriction is being added to. Otherwise, we do not add the restriction
      let line_id = mongooseModels.obj_id(req.body.lineid);
      if (
        req.body.parentid === undefined ||
        !mongooseModels.obj_id.isValid(req.body.parentid)
      ) {
        // Adding a restriction to a line without a parent
        try {
          let lines_without_parent = await mongooseModels.linesWithoutParents
            .aggregate([
              {
                $match: {
                  _id: line_id
                }
              }
            ])
            .exec();
          if (lines_without_parent >= 1) {
            let line = lines_without_parent[0];
            let save = false;
            for (restr in req.body.restrictions) {
              if (checkRestr(restr)) {
                let temp_r = {
                  tp: restr["type"],
                  an: restr["angle"] ? restr["angle"] : 0,
                  st: restr["start"],
                  ed: restr["end"],
                  ds: restr["days"],
                  wk: restr["weeks"],
                  mn: restr["months"],
                  lt: restr["limit"] ? restr["limit"] : null,
                  pm: restr["permit"] ? restr["permit"] : null,
                  ct: restr["cost"] ? restr["cost"] : null,
                  pr: restr["per"] ? restr["per"] : null,
                  ve: restr["vehicle"] ? true : false,
                  up: 0,
                  dn: 0,
                  by: req.user.id
                };
                line.restrs.push(temp_r);
                postgres.addToLines(
                  {
                    line_coords: line.loc.coordinates,
                    line_id: line._id,
                    restr_id: line.restrs[line.restrs.length - 1]._id,
                    date: Date()
                  },
                  req.user.id
                );
              }
            }
            await line.save();
            res.status(200).json({
              success: true
            });
          }
        } catch (err) {
          // couldn't find parent or something went wrong with search
          res.status(400).json({
            success: false
          });
        }
      } else {
        // Add a restriction to a line with a parent
        try {
          temp_subdocs = {};
          let parent_id = mongooseModels.obj_id(req.body.parentid);
          let the_line_parent = await mongooseModels.parents
            .findOne({
              _id: parent_id
            })
            .exec();
          if (the_line_parent !== null) {
            // we found the parent line, now find the sub-line segment
            let location = -1;
            for (let i = 0; i < length; i++) {
              if (line._id === line_id) {
                location = i;
                break;
              }
            }
            if (location !== -1) {
              for (restr in req.body.restrictions) {
                if (checkRestr(restr)) {
                  let temp_r = {
                    tp: restr["type"],
                    an: restr["angle"] ? restr["angle"] : 0,
                    st: restr["start"],
                    ed: restr["end"],
                    ds: restr["days"],
                    wk: restr["weeks"],
                    mn: restr["months"],
                    lt: restr["limit"] ? restr["limit"] : null,
                    pm: restr["permit"] ? restr["permit"] : null,
                    ct: restr["cost"] ? restr["cost"] : null,
                    pr: restr["per"] ? restr["per"] : null,
                    ve: restr["vehicle"] ? true : false,
                    up: 0,
                    dn: 0,
                    by: req.user.id
                  };
                  the_line_parent.lines[location].restrs.push(temp_r);
                  postgres.addToLines(
                    {
                      line_coords:
                        the_line_parent.lines[location].loc.coordinates,
                      parent_id: the_line_parent._id,
                      line_id: the_line_parent.lines[location]._id,
                      restr_id:
                        the_line_parent.lines[location].restrs[
                          the_line_parent.lines[location].restrs.length - 1
                        ]._id,
                      date: Date()
                    },
                    req.user.id
                  );
                  the_line_parent.lines[location].markModified("restrs");
                  the_line_parent.lines[location].restrs_length += 1;
                  the_line_parent.lines[location].markModified("restrs_length");
                  the_line_parent.total_types += 1;
                  the_line_parent.markModified("total_types");
                  the_line_parent.types_each[restr["type"]] += 1;
                  the_line_parent.markModified("types_each");
                }
              }
              // once we have added all the data to the old parent object, resave it
              await the_line_parent.save();
            }
          }
        } catch (error) {
          // Something happened in the query
          res.status(400).json({
            success: false
          });
        }
      }
    } else {
      // have to have a line within the parent or on its own to add to. Otherwise, we
      // don't know what line to add to
      if (req.user.role === "ROLE_SANDBOX") {
        return res
          .status(200)
          .json({
            success: true,
            comment:
              "We love that you're interested in helping out, but we need you to be in the app or logged in as a user."
          });
      } else {
        res.status(400).json({
          success: false
        });
      }
    }
  }
);

// should probably require this from twilio.com
router.post("/respondFromText", async function(req, res, next) {
  var ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  winston.log("info", "respond from text:", ip);
  let body = req.body.Body.split(" ");
  if (
    [2, 3, 4, 5].includes(body.length) &&
    mongooseModels.obj_id.isValid(body[0]) &&
    ["Y", "N"].includes(body[1])
  ) {
    // correct length and probably correct message
    try {
      let respText = await mongooseModels.photosText.findOne({
        _id: mongooseModels.obj_id(body[0])
      });
      let untilDate = new Date(
        body[3] + " " + body[2] + " " + respText.timezone
      );
      respText.responses.push({
        from: req.body.From,
        date: new Date(),
        canPark: body[1] === "Y",
        until: body[1] === "Y" ? untilDate : null,
        permit: body.length === 5 ? body[4] : body.length === 3 ? body[2] : null // if exists otherwise null
      });
      let notification = new apn.Notification();
      notification.expiry = Math.floor(Date.now() / 1000) + 24 * 3600;
      notification.badge = 2;
      if (body[1] === "Y") {
        notification.alert =
          "You can park at the spot you just uploaded a photo for, until: " +
          untilDate +
          " unless you have permit:" +
          body[4];
      } else {
        if (body.length === 3) {
          notification.alert =
            "You can only park there if you have permit: " + body[2];
        } else {
          notification.alert =
            "It's best if you do not park at the location you just photographed.";
        }
      }
      notification.topic = "com.curbmap.curbmap";
      notification.sound = "ping.aiff";
      notification.payload = { messageFrom: "curbmap" };
      let result = await apnProvider.send(notification, respText.token);
      respText.save();
    } catch (err) {}
  }
  var twilmsg = new MessagingResponse();
  twilmsg.message("success! Thanks for making curbmap better!");
  twilclient;
  const tempJSON = {
    from: req.body.From,
    body: req.body.Body,
    time: new Date()
  };
  fs.appendFileSync("textmessages.json", JSON.stringify(tempJSON));
  res.writeHead(200, {
    "Content-Type": "text/xml"
  });
  res.end(twilmsg.toString());
});

router.post(
  "/imageUploadText",
  passport.authenticate("jwt", { session: false }),
  upload.single("image"),
  async function(req, res, next) {
    if (findExists(req.user.role, levels.test)) {
      try {
        let newFilePath =
          req.file.path +
          "-" +
          req.body.olc +
          "-" +
          req.body.bearing +
          "-text.jpg";
        winston.log("error", fs.existsSync(req.file.path));
        fs.renameSync(req.file.path, newFilePath);
        winston.log("err", "renamed");
        if (
          req.file.size < 10000 ||
          req.body.olc === undefined ||
          req.body.olc === "" ||
          req.body.bearing === undefined ||
          req.body.bearing === "" ||
          req.body.date === "" ||
          req.body.date === undefined ||
          req.body.token === "" ||
          req.body.token === undefined
        ) {
          fs.unlinkSync(newFilePath);
          res.status(400).json({
            success: false,
            error: "file or olc error"
          });
        } else {
          let photo = new mongooseModels.photosText({
            localid: req.body.id,
            userid: req.user.id,
            filename: newFilePath,
            token: req.body.token,
            timezone: req.body.timezone,
            date: Date(),
            size: req.file.size,
            responses: []
          });
          for (let recipient of onCallList) {
            twilclient.messages
              .create({
                body:
                  "Copy this code: \n" +
                  photo._id.toString() +
                  "\n and reply with\n <Y/N> <Until what time> <on what date>" +
                  req.body.date,
                to: recipient,
                from: "+12132635292",
                mediaUrl: HOST_RES + newFilePath
              })
              .then(message =>
                winston.log("info", "MESSAGE SID:", message.sid)
              );
          }
          await photo.save();
          res.status(200).json({
            success: true
          });
        }
      } catch (e) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        } else {
          fs.unlinkSync(newFilePath);
        }
        res.status(500).json({
          success: false
        });
      }
    } else {
      fs.unlinkSync(req.file.path);
      res.status(401).json({
        success: false
      });
    }
  }
);

router.post(
  "/imageUpload",
  passport.authenticate("jwt", { session: false }),
  upload.single("image"),
  async function(req, res, next) {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "Image was not uploaded" });
    } else if (findExists(req.user.role, levels.test)) {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false
          });
        } else if (
          req.file.size < 10000 ||
          req.body.olc === undefined ||
          req.body.olc === ""
        ) {
          fs.unlinkSync(req.file.path);
          res.status(400).json({
            success: false,
            error: "file or olc error"
          });
        } else {
          if (req.body.bearing === undefined || req.body.bearing === "") {
            req.body.bearing = 0.0;
          }
          let newFilePath =
            req.file.path +
            "-" +
            req.body.olc +
            "-" +
            req.body.bearing +
            ".jpg";
          fs.renameSync(req.file.path, newFilePath);
          postgres.addToPhotos(
            {
              olc: req.body.olc,
              filename: newFilePath,
              date: Date()
            },
            req.user.id
          );
          let photo = new mongooseModels.photos({
            userid: req.user.id,
            filename: newFilePath,
            date: Date(),
            size: req.file.size,
            classifications: []
          });
          await photo.save();
          res.status(200).json({
            success: true
          });
        }
      } catch (e) {
        winston.log("error", e);
        fs.unlinkSync(req.file.path);
        res.status(500).json({
          success: false
        });
      }
    } else {
      fs.unlinkSync(req.file.path);
      if (req.user.role === "ROLE_SANDBOX") {
        res.status(200).json({
          success: true,
          info:
            "Had you been a registered user you could have submitted an image as a binary string and it would have been processed. Thank you!"
        });
      } else {
        res.status(401).json({
          success: false
        });
      }
    }
  }
);
router.get(
  "/areaOLC",
  passport.authenticate("jwt", { session: false }),
  async function(req, res, next) {
    winston.log("info", req.query);
    const time_start = new Date().getTime();
    if (
      findExists(req.user.role, levels.sandbox) &&
      req.query.code !== undefined &&
      req.query.code.length == 9 &&
      req.query.code[7] !== "0" // make sure no padding values which is valid but not useful
    ) {
      try {
        const area = openLocationCode.decode(req.query.code);
        const lng1 = area.longitudeLo;
        const lat1 = area.latitudeLo;
        const lng2 = area.longitudeHi;
        const lat2 = area.latitudeHi;
        const user = req.query.user;
        const lower = [lng1, lat1];
        const upper = [lng2, lat2];
        // diagonal distance in the view
        if (user !== undefined && user === req.user.username) {
          var query = mongooseModels.parents.find({
            loc: {
              $geoIntersects: {
                $geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [lower[0], lower[1]],
                      [lower[0], upper[1]],
                      [upper[0], upper[1]],
                      [upper[0], lower[1]],
                      [lower[0], lower[1]]
                    ]
                  ]
                }
              }
            },
            "lines.restrs": {
              $elemMatch: {
                by: req.user.id
              }
            }
          });
          query.exec(function(err, result) {
            try {
              let results_to_send;
              results_to_send = processResults(result, true);
              res.status(200).json(results_to_send);
            } catch (e) {
              winston.log("warn", "error", e);
            }
          });
        } else {
          var query = mongooseModels.parents.find({
            loc: {
              $geoIntersects: {
                $geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [lower[0], lower[1]],
                      [lower[0], upper[1]],
                      [upper[0], upper[1]],
                      [upper[0], lower[1]],
                      [lower[0], lower[1]]
                    ]
                  ]
                }
              }
            }
          });
          query.exec(function(err, result) {
            try {
              const time_end_results = new Date().getTime();
              winston.log("warn", "time elapsed in mongo", {
                results_from_mongo: result.length,
                time: time_end_results - time_start
              });
              // winston.log('info', util.inspect(result, {depth: null}));
              let results_to_send;
              if (req.query.code.length >= 11) {
                results_to_send = processResults(result, true);
              } else {
                results_to_send = processResults(result, false);
              }
              res.status(200).json(results_to_send);
              const time_end = new Date().getTime();
              winston.log("warn", "time elapsed in processing", {
                results_length: results_to_send.length,
                time: time_end - time_end_results
              });
            } catch (e) {
              winston.log("info", "error in query", e);
            }
          });
        }
      } catch (e) {
        winston.log("info", "Error: " + e);
        res.json({ error: e });
      }
    } else {
      res.json({ error: "error" });
    }
  }
);

router.get(
  "/areaPolygon",
  passport.authenticate("jwt", { session: false }),
  function(req, res, next) {
    const time_start = new Date().getTime();
    if (
      findExists(req.user.role, levels.sandbox) &&
      req.query.lat1 !== undefined &&
      req.query.lat2 !== undefined &&
      req.query.lng1 !== undefined &&
      req.query.lng2 !== undefined
    ) {
      try {
        const lng1 = parseFloat(req.query.lng1);
        const lat1 = parseFloat(req.query.lat1);
        const lng2 = parseFloat(req.query.lng2);
        const lat2 = parseFloat(req.query.lat2);
        const user = req.query.user;
        const lower = [lng1, lat1];
        const upper = [lng2, lat2];
        const distance = geolib.getDistance(
          {
            longitude: lower[0],
            latitude: upper[1]
          },
          {
            longitude: upper[0],
            latitude: upper[1]
          }
        ); // keep the distance to one dimension
        winston.log("info", "DISTANCE:", {
          distance: distance
        });
        // diagonal distance in the view
        if (user !== undefined && user === req.user.username) {
          var query = mongooseModels.parents.find({
            loc: {
              $geoIntersects: {
                $geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [lower[0], lower[1]],
                      [lower[0], upper[1]],
                      [upper[0], upper[1]],
                      [upper[0], lower[1]],
                      [lower[0], lower[1]]
                    ]
                  ]
                }
              }
            },
            "lines.restrs": {
              $elemMatch: {
                b: req.user.id
              }
            }
          });
          query.exec(function(err, result) {
            try {
              let results_to_send;
              results_to_send = processResults(result, true);
              res.status(200).json(results_to_send);
            } catch (e) {
              winston.log("warn", "error", e);
            }
          });
        } else if (distance < 3000) {
          var query = mongooseModels.parents.find({
            loc: {
              $geoIntersects: {
                $geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [lower[0], lower[1]],
                      [lower[0], upper[1]],
                      [upper[0], upper[1]],
                      [upper[0], lower[1]],
                      [lower[0], lower[1]]
                    ]
                  ]
                }
              }
            }
          });
          query.exec(function(err, result) {
            try {
              const time_end_results = new Date().getTime();
              winston.log("warn", "time elapsed in mongo", {
                results_from_mongo: result.length,
                time: time_end_results - time_start
              });
              // winston.log('info', util.inspect(result, {depth: null}));
              let results_to_send;
              if (distance < 1200) {
                results_to_send = processResults(result, true);
              } else {
                results_to_send = processResults(result, false);
              }
              res.status(200).json(results_to_send);
              const time_end = new Date().getTime();
              winston.log("warn", "time elapsed in processing", {
                results_length: results_to_send.length,
                time: time_end - time_end_results
              });
            } catch (e) {
              winston.log("info", "error in query", e);
            }
          });
        }
      } catch (e) {
        winston.log("info", "Error: " + e);
        res.json({});
      }
    } else {
      res.json({});
    }
  }
);
var findExists = function(needle, haystack) {
  return haystack.indexOf(needle) >= 0;
};

var constructBoxesFrom = function(boxes) {
  let newBoxes = [];
  for (box of boxes) {
    newBoxes.push({
      origin_x: box.x,
      origin_y: box.y,
      width: box.width,
      height: box.height,
      categories: [box.type.key]
    });
  }
  return newBoxes;
};

var checkRestr = function(restr) {
  return (
    restr.type !== undefined &&
    checkDurationForType(restr.type, restr.duration) &&
    checkPermitForType(restr.type, restr.permit) &&
    checkCostForType(restr.type, restr.cost, restr.per) &&
    restr.side !== undefined &&
    restr.angle !== undefined &&
    typeof restr.days === "object" &&
    restr.days.length === 7 &&
    typeof restr.weeks === "object" &&
    restr.weeks.length === 4 &&
    typeof restr.months === "object" &&
    restr.months.length === 12 &&
    restr.start !== undefined &&
    restr.start >= 0 &&
    restr.start <= 1440 &&
    restr.end >= 0 &&
    restr.end <= 1440
  );
};

var checkDurationForType = function(type, duration) {
  if (type == 0 || type == 1) {
    // Short term parking < 1hour (green or metered green)
    return !isNull(duration) && duration < 60;
  } else if (type == 2 || type == 3) {
    // Timed parking >= 1hour (metered or time limited)
    return !isNull(duration) && duration >= 60;
  } else if (type == 4) {
    // Time limit with permit... duration must be defined and a valid value
    return !isNull(duration) && duration > 0 && duration <= 1440;
  } else if (!isNull(duration)) {
    // Some other type that has a defined duration allowed but must be valid I've
    // never seen more than 10 hour parking, but if there is like
    return duration > 0 && duration <= 1440;
  }
  // Otherwise an undefined or null duration is fine
  return true;
};
var checkPermitForType = function(type, permit) {
  if (type == 4) {
    return !isNull(permit) && permit !== "";
  }
  return true;
};

var checkCostForType = function(type, cost, per) {
  if (type == 1 || type == 3 || type == 5) {
    return !isNull(cost) && cost > 0 && per > 0;
  }
  return true;
};

/**
 *
 * [
    {
        "coordinates": [
            [
                -118.39948662956259, 33.86036165768069
            ],
            [-118.39957828981149, 33.86072773869277]
        ],
        "key": "5a3e0efe05428533d9023ae9",
        "lines": []
    }, {
        "coordinates": [
            [
                -118.39939211604425, 33.86000088733579
            ],
            [-118.39948672680943, 33.860362037301186]
        ],
        "key": "5a3e0efe05428533d9023b47",
        "lines": [
            {
                "key": "5a3eefff30a3b22dfd0c045b",
                "restrs": [
                    {
                        "id": "5a3eefff30a3b22dfd0c045c",
                        "tp": 3,
                        "an": 0,
                        "st": 600,
                        "ed": 1440,
                        "ds": [
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true
                        ],
                        "wk": [
                            true, true, true, true
                        ],
                        "mn": [
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true,
                            true
                        ],
                        "ct": 0.25,
                        "pr": 12,
                        "up": 0,
                        "dn": 0
                    }
                ],
                "coords": [
                    [
                        -118.3997778, 33.8608611
                    ],
                    [-118.3997414, 33.8607043]
                ]
            }
        ]
    }
]
 * @param results, JSON from mongo
 * @param points, boolean whether to include lines (sufficiently small enough OLC/polygon size/or just user's points)
 * @returns {Array}
 */
let processResults = function(results, getLines) {
  let returnResults = [];
  for (let result in results) {
    let newResponse = {};
    newResponse["coordinates"] = results[result].loc.coordinates;
    newResponse["key"] = results[result]._id.toString();
    newResponse["lines"] = [];
    if (getLines) {
      for (let line of results[result].lines) {
        if (line.restrs_length > 0) {
          let newLine = {
            key: line._id.toString(),
            restrs: []
          };
          newLine["coords"] = line.loc.coordinates;
          line.restrs.forEach((restr, idx) => {
            newLine.restrs.push({
              id: restr._id.toString(),
              tp: restr["tp"],
              an: restr["an"],
              st: restr["st"],
              ed: restr["ed"],
              ds: restr["ds"],
              wk: restr["wk"],
              mn: restr["mn"],
              lt: restr["lt"],
              pm: restr["pm"],
              ct: restr["ct"],
              pr: restr["pr"],
              ve: restr["ve"],
              up: restr["up"],
              dn: restr["dn"]
            });
          });
          newResponse["lines"].push(newLine);
        }
      }
    } else {
      // don't get lines
    }
    newResponse["total_types"] = results[result].total_types;
    newResponse["types_each"] = results[result].types_each;

    returnResults.push(newResponse);
  }
  return returnResults;
};

module.exports = router;
