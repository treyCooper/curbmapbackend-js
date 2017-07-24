'use strict';
const geolib = require('geolib');
const atob = require('atob');
const mongooseModels = require("../model/mongooseModels.js");
const postgres = require('../model/postgresModels');
const levels = {
  user: ["ROLE_USER", "ROLE_ADMIN", "ROLE_OWNER"],
  admin: ["ROLE_ADMIN", "ROLE_OWNER"],
  owner: ["ROLE_OWNER"],
};
const maxSize = 2 * 1000 * 1000;
const multer  = require('multer');
const upload = multer({ limits: { fileSize: maxSize } });
const Jimp = require("jimp");
const passport = require('passport');
const winston = require('winston');

/**
 * This is a messy endpoint but it checks a lot of things
 * 0th: We test if there is a Authorization token passed
 * First: we test if the values entered on the query string are correct types
 * Second: We test that there is in fact a user associated with the account that was in the auth token
 * Third: We add the point to the closest line
 * Fourth: We add the point to the user's list of points_created in the points table
 */
function api(app, redisclient) {
  app.get('/addPoint', passport.authMiddleware(redisclient), function (req, res, next) {
    if (req.query.lat !== undefined && req.query.lng !== undefined && req.query.rule !== undefined) {
      try {
        var lat = parseFloat(req.query.lat);
        var lng = parseFloat(req.query.lng);
        var rule = atob(req.query.rule).split(",");
        if (rule < 4) {
          res.json({"success": false});
          return;
        }
                // Query for line within 20 meters
        var query = mongooseModels.model.aggregate([
          {
            "$geoNear": {
              "near": {
                "type": "Point",
                "coordinates": [lng, lat]
              },
              "distanceField": "distance",
              "spherical": true,
              "maxDistance": 20
            }
          },
                    {"$limit": 1}
        ]);
        query.exec(function (err, result) {
                    // If no result!
          if (result[0] === undefined) {
            res.json({"success": false});
            return;
          }
                    // Or if an error in the result
          if (err) {
            res.json({"success": false});
            return;
          }
          id = result[0]['_id'];
          var date = new Date();
          var temp = {
            t: rule[0],
            d: rule[1],
            s: rule[2],
            e: rule[3],
            u: date.toISOString(),
            b: req.user.user_id,
            r: 0.6,
            l: 0,
            c: 0.0,
            p: 0
          };
          if (rule.length >= 5) {
            temp['l'] = rule[4];
          }
          if (rule.length === 7) {
            temp['c'] = rule[5];
            temp['p'] = rule[6];
          }
          var update = mongooseModels.model.findOneAndUpdate(
            {"_id": id},
            {
              "$push": {
                "points": {
                  "point": [lng, lat], "restrs": [temp]
                }
              }
            },
            {upsert: true}
          );
          update.exec(function (err, resultupdated) {
            if (err) throw new Error("could not update line");
            postgres.Point.findOne({where: {user_id: req.user.user_id}}).then(function (userPoints) {
              if (userPoints !== null) {
                var newPoints = userPoints.points_created;
                winston.log('info', typeof newPoints);
                postgres.addToPoints({
                  "point": [lng, lat],
                  "restrs": [temp]
                }, req.user.user_id, res);
              } else {
                postgres.Point.build({
                  user_id: req.user.user_id,
                  points_created: [{"point": [lng, lat], "restrs": [temp]}]
                }).save().then(function () {
                  res.json({"success": true});
                })
              }
            })
          });
        })
      } catch (error) {
        winston.log('info', "Error" + error);
        res.json({"success": false});
      }
    }
  });

  app.post('/imageUpload', passport.authMiddleware(redisclient), upload.single('image'), function (req, res, next) {
    if (findExists(req.session.role, levels.user)) {
      try {
        Jimp.read(req.file.buffer, function (err, image) {
          if (err) {
            res.status(500).json({})
          } else {
            var w = image.bitmap.width;
            var h = image.bitmap.height;
            var newfilename = req.user.id + (new Date()).toISOString() + '.png';
            if (w > h) {
              image.resize(800, Jimp.AUTO, Jimp.RESIZE_BICUBIC).quality(100).greyscale().write("uploads/" + newfilename);
            } else {
              image.resize(Jimp.AUTO, 800, Jimp.RESIZE_BICUBIC).quality(100).greyscale().write("uploads/" + newfilename);
            }
            res.status(200).json({});
          }
        })
      } catch (e) {
        res.status(500);
      }
    } else {
      res.status(401);
    }
  });

  app.get('/areaPolygon', passport.authMiddleware(redisclient), function (req, res, next) {
    const time_start = new Date().getTime();
    if (findExists(req.session.role, levels.user)
            && req.query.lat1 !== undefined && req.query.lat2 !== undefined && req.query.lng1 !== undefined && req.query.lng2 !== undefined
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
          {longitude: lower[0], latitude: upper[1]},
          {longitude: upper[0], latitude: upper[1]}); // keep the distance to one dimension
        winston.log('info', 'DISTANCE:', {distance: distance} );
        // diagonal distance in the view
        if (user !== undefined && user  === req.session.passport.user) {
          var query = mongooseModels.model.find({
            "loc": {
              "$geoIntersects": {
                "$geometry": {
                  "type": "Polygon",
                  "coordinates": [[
                    [lower[0], lower[1]],
                    [lower[0], upper[1]],
                    [upper[0], upper[1]],
                    [upper[0], lower[1]],
                    [lower[0], lower[1]]
                  ]]
                }
              }
            },
            "points.restrs": {
              "$elemMatch": {
                b: req.session.userid
              }
            }
          });
          query.exec(function (err, result) {
            try {
                              // winston.log('info', util.inspect(result, {depth: null}));
              let results_to_send;
              results_to_send = processResults(result, true);
              res.status(200).json(results_to_send);
            } catch (e) {
              winston.log(e)
            }
          });
        } else if (distance < 5000) {
          var query = mongooseModels.model.find({
            "loc": {
              "$geoIntersects": {
                "$geometry": {
                  "type": "Polygon",
                  "coordinates": [[
                    [lower[0], lower[1]],
                    [lower[0], upper[1]],
                    [upper[0], upper[1]],
                    [upper[0], lower[1]],
                    [lower[0], lower[1]]
                  ]]
                }
              }
            }
          });
          query.exec(function (err, result) {
            try {
              const time_end_results = new Date().getTime()
              winston.log('warn', 'time elapsed in mongo', {results_from_mongo: result.length, time: time_end_results-time_start})
                              // winston.log('info', util.inspect(result, {depth: null}));
              let results_to_send;
              if (distance < 1500) {
                results_to_send = processResults(result, true);
              } else {
                results_to_send = processResults(result, false);
              }
              res.status(200).json(results_to_send);
              const time_end = new Date().getTime();
              winston.log('warn', 'time elapsed in processing', {results_length: results_to_send.length, time: time_end-time_end_results})
            } catch (e) {
              winston.log('info', e)
            }
          });
        }
      } catch (e) {
        winston.log('info', "Error: " + e);
        res.json({})
      }
    }
    else {
      res.json({});
    }
  });

  app.get('/areaCircle', passport.authMiddleware(redisclient), function (req, res, next) {
    if (req.user.aud[0] === "curbmap-resource" && findExists(req.user.authorities, levels.user)) {
      var center = [req.query.lng, req.query.lat];
      var rad = req.query.rad;
      winston.log('info', rad);
      if (rad < 50) {
        var query = mongooseModels.model.find({
          "loc": {
            "$geoWithin": {"$center": [center, rad]}
          }
        });
        query.exec(function (err, result) {
          try {
            var results_to_send = processResults(result);
            res.json(results_to_send);
          } catch (e) {
            winston.log('info', e)
          }
        });
      }
      else {
        res.json({});
      }
    }
    else {
      res.json({});
    }
  });
}

var findExists = function (needle, haystack) {
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
 * @returns {Array}
 */
var processResults = function(results, points) {
  var returnResults = [];
  for (var result in results) {
    if (results[result].points.length === 0 && results[result].restrs.length === 0)
      continue
    var newResponse = {};
    newResponse["coordinates"] = results[result].loc.coordinates;
    newResponse["restrs"] = results[result].restrs;
    newResponse["multiPointProperties"] = {
      "points": [],
      "restrs": []
    };
    newResponse["key"] = results[result].gid;
    if (points) {
            // results is an array, [] here is related to index value not key/value
      for (var point in results[result].points) {
        if (results[result].points[point].point !== [] &&
                    results[result].points[point].point !== null &&
                    results[result].points[point].point !== undefined &&
                    results[result].points[point].restrs !== undefined
                ) {
          newResponse.multiPointProperties.points.push(results[result].points[point].point);
          var newRestr = [];
          results[result].points[point].restrs.forEach(function (restr, idx) {
            newRestr.push(restr['t'], restr['d'], restr['s'], restr['e'], restr['r'], restr['l'], restr['c'], restr['p']); // take out user id
          });
          newResponse.multiPointProperties.restrs.push(newRestr);
        }
      }
    }
    returnResults.push(newResponse)
  }
  return returnResults;
};



module.exports = api;
