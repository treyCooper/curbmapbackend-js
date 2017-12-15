/* "use strict"; */
const geolib = require("geolib");
const atob = require("atob");
const mongooseModels = require("../model/mongooseModels.js");
const postgres = require("../model/postgresModels");
const OpenLocationCode = require("open-location-code").OpenLocationCode;
const openLocationCode = new OpenLocationCode();
const fs = require("fs");
const uuidv1 = require("uuid/v1");
const levels = {
    user: ["ROLE_USER", "ROLE_ADMIN", "ROLE_OWNER"],
    admin: ["ROLE_ADMIN", "ROLE_OWNER"],
    owner: ["ROLE_OWNER"]
};
const maxSize = 2 * 1000 * 1000;
const multer = require("multer");
const upload = multer({
    limits: {
        fileSize: maxSize
    }
});
const Jimp = require("jimp");
const passport = require("passport");
const winston = require("winston");
const MessagingResponse = require("twilio").twiml.MessagingResponse;

/**
 * This is a messy endpoint but it checks a lot of things
 * 0th: We test if there is a Authorization token passed
 * First: we test if the values entered on the query string are correct types
 * Second: We test that there is in fact a user associated with the account that was in the auth token
 * Third: We add the point to the closest line
 * Fourth: We add the point to the user's list of points_created in the points table
 */
function api(app, redisclient) {
    app.post("/addLine", passport.authMiddleware(redisclient), async function(req, res, next) {
        if (
            typeof req.body.line !== "object" ||
            req.body.line.length < 2 || // start end points must exist for line to exist
            typeof req.body.restrictions !== "object" ||
            req.body.restrictions.length == 0
        ) {
            res.status(400).json({ success: false });
        } else {
            winston.log("error", "HERE!!!XXX");
            try {
                if (req.body.parentid === undefined || !mongooseModels.obj_id.isValid(req.body.parentid)) {
                    // this type does not get added to a parent line, so it is parentless and gets added to the
                    // Lines collection which hasn't had
                    let new_line = new mongooseModels.linesWithoutParents({
                        loc: { type: "LineString", coordinates: req.body.line },
                        restrs: [],
                        restrs_length: 0
                    });
                    console.log(new_line);
                    for (restr of req.body.restrictions) {
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
                                mo: restr.motorcycle,
                                up: 0,
                                dn: 0,
                                by: req.session.userid,
                                ud: new Date()
                            };
                            new_line.restrs.push(restr_checked);
                            new_line.restrs_length++;
                        }
                    }
                    if (new_line.restrs.length > 0) {
                        winston.log("error", new_line.restrs.length);
                        new_line.save();
                        res.status(200).json({ success: true });
                    } else {
                        res.status(200).json({ success: false });
                    }
                } else {
                    let parent_id = mongooseModels.obj_id(req.body.parentid);
                    winston.log("error", parent_id);
                    let parents = await mongooseModels.parents
                        .find({
                            _id: parent_id
                        })
                        .exec();
                    winston.log("error", parents);
                    if (parents.length > 0) {
                        winston.log("info", "length", parents.length);
                        let parent = parents[0];
                        parent.lines.push({ loc: { type: "LineString", coordinates: req.body.line } });
                        let new_length = parent.lines.length;
                        winston.log("error", new_length);
                        let checked_restrs = [];
                        for (restr of req.body.restrictions) {
                            winston.log("error", "XXX restr each:", restr);
                            if (checkRestr(restr)) {
                                winston.log("error", "XXX restr", restr);
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
                                    mo: restr.motorcycle,
                                    up: 0,
                                    dn: 0,
                                    by: req.session.userid,
                                    ud: new Date()
                                };
                                parent.lines[new_length - 1].restrs.push(restr_checked);
                            }
                        }
                        // Went through all new restrictions... now test if any were correct and added
                        if (parent.lines[new_length - 1].restrs.length > 0) {
                            // If the new line has some restrictions, add it, otherwise, don't
                            await parent.save();
                            res.status(200).json({ success: true });
                        } else {
                            res.status(200).json({ success: false });
                        }
                    }
                }
            } catch (error) {
                winston.log("warn", error);
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
        winston.log("info", "downVote", {
            body: req.body,
            headers: req.header
        });
        // TODO: MUST WRITE Down Voting of restriction
    });

    app.post("/addLineRestr", passport.authMiddleware(redisclient), async function(req, res, next) {
        winston.log("info", req.body);
        try {
            temp_subdocs = {};
            let line_sub_docs = await mongooseModels.parents
                .aggregate([
                    {
                        $match: {
                            _id: req.body.parentid
                        }
                    },
                    {
                        limit: 1
                    }
                ])
                .exec();
            if (docs.length >= 1) {
                // we found the line
                the_line_parent = docs[0];
                let location = -1;
                for (let i = 0; i < length; i++) {
                    if (line._id === req.body.lineid) {
                        location = i;
                        break;
                    }
                }
                for (restr in req.body.restrictions) {
                    let temp_r = {
                        tp: restr["type"],
                        an: restr["angle"] ? restr["angle"] : 0,
                        st: restr["start"],
                        ed: restr["end"],
                        ds: restr["days"],
                        wk: restr["weeks"],
                        mn: restr["mn"],
                        lt: restr["limit"] ? restr["limit"] : null,
                        pm: restr["permit"] ? restr["permit"] : null,
                        ct: restr["cost"] ? restr["cost"] : null,
                        pr: restr["per"] ? restr["per"] : null,
                        mo: restr["motorcycle"] ? true : false,
                        up: 0,
                        dn: 0,
                        by: req.session.userid
                    };
                    the_line_parent.lines[location].create(temp_r);
                }
                the_line_parent.save();
            }
        } catch (error) {}
    });

    app.post("/getdatafromtext", function(req, res, next) {
        var twilmsg = new MessagingResponse();
        twilmsg.message("success! Thanks for making curbmap better!");
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
                        $geoWithin: {
                            $center: [center, rad]
                        }
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
        return duration !== undefined && duration < 60;
    } else if (type == 2 || type == 3) {
        // Timed parking >= 1hour (metered or time limited)
        return duration !== undefined && duration >= 60;
    } else if (type == 4) {
        // Time limit with permit... duration must be defined and a valid value
        return duration !== undeinfed && duration > 0 && duration <= 1440;
    } else if (duration !== undefined) {
        // Some other type that has a defined duration allowed but must be valid
        // I've never seen more than 10 hour parking, but if there is like
        return duration > 0 && duration < 1440;
    }
    // Otherwise an undefined or null duration is fine
    return true;
};
var checkPermitForType = function(type, permit) {
    if (type == 4 || type == 6) {
        return (
            permit !== undefined &&
            !isNull(permit) &&
            permit !== "Disabled" &&
            permit !== "Taxi" &&
            permit !== "Commercial" &&
            permit !== "Other"
        );
    } else if (type == 10) {
        return permit !== undefined && permit === "Disabled";
    }
    return true;
};

var checkCostForType = function(type, cost, per) {
    if (type == 1 || type == 3) {
        return cost !== undefined && per !== undefined && cost > 0 && per > 0;
    }
    return true;
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
