"use strict";
const geolib = require("geolib");
const atob = require("atob");
const mongooseModels = require("../model/mongooseModels.js");
const postgres = require("../model/postgresModels");
const OpenLocationCode = require("open-location-code").OpenLocationCode;
const openLocationCode = new OpenLocationCode();
const uuidv1 = require("uuid/v1");
const levels = {
  user: ["ROLE_USER", "ROLE_ADMIN", "ROLE_OWNER"],
  admin: ["ROLE_ADMIN", "ROLE_OWNER"],
  owner: ["ROLE_OWNER"]
};
const maxSize = 2 * 1000 * 1000;
const multer = require("multer");
const upload = multer({ limits: { fileSize: maxSize } });
const Jimp = require("jimp");
const passport = require("passport");
const winston = require("winston");

/**
 * This is a messy endpoint but it checks a lot of things
 * 0th: We test if there is a Authorization token passed
 * First: we test if the values entered on the query string are correct types
 * Second: We test that there is in fact a user associated with the account that was in the auth token
 * Third: We add the point to the closest line
 * Fourth: We add the point to the user's list of points_created in the points table
 */
function api(app, redisclient) {
  app.post("/addPoint", passport.authMiddleware(redisclient), function(req, res, next) {
    winston.log("warn", "addPoint", typeof req.body.point.lat);
    {
      if (req.body.point.lat !== undefined && req.body.point.lng !== undefined && req.body.restriction.length >= 1) {
        try {
          // Query for line within 20 meters
          var query = mongooseModels.model.aggregate([
            {
              $geoNear: {
                near: {
                  type: "Point",
                  coordinates: [req.body.point.lng, req.body.point.lat]
                },
                distanceField: "distance",
                spherical: true,
                maxDistance: 20
              }
            },
            { $limit: 1 }
          ]);
          query.exec(function(err, result) {
            // If no result!
            if (result[0] === undefined) {
              res.json({ success: false });
              return;
            }
            // Or if an error in the result
            if (err) {
              res.json({ success: false });
              return;
            }
            let id = result[0]["_id"];
            // don't duplicate points
            for (let pointTemp of result[0].points) {
              if (pointTemp.point[0] === req.body.point.lng && pointTemp.point[1] === req.body.point.lat) {
                res.json({ success: false, reason: "point exists" });
                return;
              }
            }
            let date = new Date();
            let restrs = [];
            for (let rule of req.body.restriction) {
              let temp = new mongooseModels.restrs();
              temp.i = uuidv1();
              temp.t = rule["type"];
              temp.d = rule["days"];
              temp.s = rule["startTime"];
              temp.e = rule["endTime"];
              temp.u = date.getTime();
              temp.b = req.session.userid;
              temp.l = rule["timeLimit"] === undefined ? 0 : rule["timeLimit"];
              temp.c = rule["cost"] === undefined ? 0 : rule["cost"];
              temp.p = rule["per"] === undefined ? 0 : rule["per"];
              temp.up = 1;
              temp.dn = 0;
              temp.an = rule["angle"];
              restrs.push(temp);
            }
            let newPoint = new mongooseModels.points();
            newPoint.point = [req.body.point.lng, req.body.point.lat];
            newPoint.restrs = restrs;
            var update = mongooseModels.model.findOneAndUpdate(
              { _id: id },
              {
                $push: {
                  points: newPoint
                }
              },
              { upsert: true }
            );
            update.exec(function(err, resultupdated) {
              if (err) throw new Error("could not update line");
              postgres.Point.findOne({ where: { user_id: req.session.userid } }).then(function(userPoints) {
                if (userPoints !== null) {
                  let newPoints = userPoints.points_created;
                  postgres.addToPoints(
                    {
                      point: [req.body.point.lng, req.body.point.lat],
                      restrs: restrs
                    },
                    req.session.userid,
                    res
                  );
                } else {
                  postgres.Point
                    .build({
                      user_id: req.session.userid,
                      points_created: [{ point: [req.body.point.lng, req.body.point.lat], restrs: restrs }]
                    })
                    .save()
                    .then(function() {
                      res.json({ success: true });
                    });
                }
              });
            });
          });
        } catch (error) {
          winston.log("info", "Error" + error);
          res.json({ success: false });
        }
      }
    }
  });
  app.post("/upVote", passport.authMiddleware(redisclient), function(req, res, next) {
    if (req.session.passport.user === "curbmaptest") {
      return next();
    }

    // TODO: MUST WRITE up Voting of restriction
  });
  app.post("/downVote", passport.authMiddleware(redisclient), function(req, res, next) {
    winston.log("info", "downVote", { body: req.body, headers: req.header });
    // TODO: MUST WRITE Down Voting of restriction
  });

  app.post("/addPointRestr", passport.authMiddleware(redisclient), function(req, res, next) {
    winston.log("info", req.body);
    let rules = [];
    let newRestrs = [];
    let date = new Date();
    for (let rule of req.body.restrs) {
      let temp = {
        i: uuidv1(),
        t: rule["type"],
        d: rule["days"],
        s: rule["startTime"],
        e: rule["endTime"],
        u: date.getTime(),
        b: req.session.userid,
        l: rule["timeLimit"] === undefined ? 0 : rule["timeLimit"],
        c: rule["cost"] === undefined ? 0 : rule["cost"],
        p: rule["per"] === undefined ? 0 : rule["per"],
        up: 1,
        dn: 0,
        an: rule["angle"]
      };
      rules.push(rule["updated"]);
      newRestrs.push(temp);
    }
    let objRules = {};
    for (let i = 0; i < rules.length; i++) {
      objRules[rules[i]] = [
        newRestrs[i]["i"],
        newRestrs[i]["t"],
        newRestrs[i]["s"],
        newRestrs[i]["e"],
        newRestrs[i]["d"],
        newRestrs[i]["an"],
        newRestrs[i]["u"],
        newRestrs[i]["up"],
        newRestrs[i]["dn"],
        newRestrs[i]["l"],
        newRestrs[i]["c"],
        newRestrs[i]["p"]
      ];
    }
    let update = mongooseModels.model.findOneAndUpdate(
      { "points.point_id": req.body.point_id },
      { $push: { "points.$.restrs": { $each: newRestrs } } },
      { upsert: true, multi: true }
    );
    update.exec((err, result) => {
      if (err) {
        winston.log("warn", "could not update restriction for point", { point: req.body.point_id, error: err });
        res.status(200).json({ success: false });
      } else {
        res.status(200).json({ success: true, rules: objRules });
      }
    });
  });

  app.post("/imageUpload", passport.authMiddleware(redisclient), upload.single("image"), function(req, res, next) {
    if (findExists(req.session.role, levels.user)) {
      try {
        Jimp.read(req.file.buffer, function(err, image) {
          if (err) {
            res.status(500).json({});
          } else {
            var w = image.bitmap.width;
            var h = image.bitmap.height;
            var newfilename = req.user.id + new Date().toISOString() + ".png";
            if (w > h) {
              image
                .resize(800, Jimp.AUTO, Jimp.RESIZE_BICUBIC)
                .quality(100)
                .greyscale()
                .write("uploads/" + newfilename);
            } else {
              image
                .resize(Jimp.AUTO, 800, Jimp.RESIZE_BICUBIC)
                .quality(100)
                .greyscale()
                .write("uploads/" + newfilename);
            }
            res.status(200).json({});
          }
        });
      } catch (e) {
        res.status(500);
      }
    } else {
      res.status(401);
    }
  });
  app.get("/areaOLC", passport.authMiddleware(redisclient), function(req, res, next) {
    const time_start = new Date().getTime();
    if (
      findExists(req.session.role, levels.user) &&
      req.query.code !== undefined &&
      req.query.code.length >= 9 &&
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
        if (user !== undefined && user === req.session.passport.user) {
          var query = mongooseModels.model.find({
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
            "points.restrs": {
              $elemMatch: {
                b: req.user.id_user
              }
            }
          });
          query.exec(function(err, result) {
            try {
              // winston.log('info', util.inspect(result, {depth: null}));
              let results_to_send;
              results_to_send = processResults(result, true);
              res.status(200).json(results_to_send);
            } catch (e) {
              winston.log("warn", "error", e);
            }
          });
        } else {
          var query = mongooseModels.model.find({
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
              if (req.query.code.length >= 10) {
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
  });

  app.get("/areaPolygon", passport.authMiddleware(redisclient), function(req, res, next) {
    const time_start = new Date().getTime();
    if (
      findExists(req.session.role, levels.user) &&
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
          { longitude: lower[0], latitude: upper[1] },
          { longitude: upper[0], latitude: upper[1] }
        ); // keep the distance to one dimension
        winston.log("info", "DISTANCE:", { distance: distance });
        // diagonal distance in the view
        if (user !== undefined && user === req.session.passport.user) {
          var query = mongooseModels.model.find({
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
            "points.restrs": {
              $elemMatch: {
                b: req.session.userid
              }
            }
          });
          query.exec(function(err, result) {
            try {
              // winston.log('info', util.inspect(result, {depth: null}));
              let results_to_send;
              results_to_send = processResults(result, true);
              res.status(200).json(results_to_send);
            } catch (e) {
              winston.log("warn", "error", e);
            }
          });
        } else if (distance < 3000) {
          var query = mongooseModels.model.find({
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
  });

  app.get("/areaCircle", passport.authMiddleware(redisclient), function(req, res, next) {
    if (req.user.aud[0] === "curbmap-resource" && findExists(req.user.authorities, levels.user)) {
      var center = [req.query.lng, req.query.lat];
      var rad = req.query.rad;
      winston.log("info", rad);
      if (rad < 50) {
        var query = mongooseModels.model.find({
          loc: {
            $geoWithin: { $center: [center, rad] }
          }
        });
        query.exec(function(err, result) {
          try {
            var results_to_send = processResults(result);
            res.json(results_to_send);
          } catch (e) {
            winston.log("info", e);
          }
        });
      } else {
        res.json({});
      }
    } else {
      res.json({});
    }
  });
}

var findExists = function(needle, haystack) {
  return haystack.indexOf(needle) >= 0;
};

/**
 * Takes a JSON as stored in MongoDB and returns array of
 *
 [
 {
   "coordinates": "Array of arrays of 2 doubles.. e.g. [[-118.1, 34], [...]]",
   "restrs": [
     [
       "type, see below for types",
       "days 7 bits, see below for convention",
       "24-hour start local time",
       "24-hour end local time",
       "reliability score",
       "ISO UTC String"
     ]
   ],
   "multiPointProperties": {
     "points": "Array of arrays of 2 doubles see above but referring to individual ordered points",
     "restrs": "Array of arrays of restrs as above but referring to the individual ordered points"
   }
 },
 {
   "...": "..."
 }
 ]
 * @param results, JSON from mongo
 * @param points, boolean whether to include points (sufficiently small radius)
 * @returns {Array}
 */
let processResults = function(results, points) {
  let returnResults = [];
  for (let result in results) {
    if (results[result].points.length === 0 && results[result].restrs.length === 0) {
      continue;
    }
    let newResponse = {};
    newResponse["coordinates"] = results[result].loc.coordinates;
    newResponse["restrs"] = [];
    for (let lineRestr of results[result].restrs) {
      newResponse["restrs"].push(
        lineRestr["i"],
        lineRestr["t"],
        lineRestr["s"],
        lineRestr["e"],
        lineRestr["d"],
        lineRestr["an"],
        lineRestr["u"],
        lineRestr["up"],
        lineRestr["dn"],
        lineRestr["l"],
        lineRestr["c"],
        lineRestr["p"]
      );
    }
    newResponse["multiPointProperties"] = {
      points: [],
      restrs: [],
      ids: []
    };
    newResponse["key"] = results[result].gid;
    if (points) {
      for (let point of results[result].points) {
        if (
          point.point !== null &&
          point.point !== undefined &&
          point.point.length === 2 &&
          point.restrs !== undefined
        ) {
          newResponse.multiPointProperties.points.push(point.point);
          let newRestr = [];
          point.restrs.forEach((restr, idx) => {
            newRestr.push([
              restr["i"],
              restr["t"],
              restr["s"],
              restr["e"],
              restr["d"],
              restr["an"],
              restr["u"],
              restr["up"],
              restr["dn"],
              restr["l"],
              restr["c"],
              restr["p"]
            ]); // take out user id
          });
          newResponse.multiPointProperties.restrs.push(newRestr);
          newResponse.multiPointProperties.ids.push(point.point_id.toString());
        }
      }
    }
    returnResults.push(newResponse);
  }
  return returnResults;
};

module.exports = api;
