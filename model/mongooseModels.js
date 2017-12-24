"use strict";
const mongoose = require("mongoose");
const GeoJSON = require("mongoose-geojson-schema");
const uri = `mongodb://${process.env.MONGO_SHARD_0},${process.env.MONGO_SHARD_1},${process.env.MONGO_SHARD_2}/${process.env.MONGO_DB}?ssl=true&replicaSet=${process.env.MONGO_REPLSET}&authSource=admin`;

// mongoose.connect(uri);
mongoose.Promise = require("bluebird");

const HeatMapSchema = new mongoose.Schema({
    six_sig_olc: {
        type: String,
        index: true
    }, // Must actually be full 9 characters with two 00 padding and +
    corners: [
        [
            {
                type: Number
            }
        ]
    ], // Two opposite corners of region (most likely NW, SE)
    total_types: {
        type: Number,
        default: 0
    },
    types_each: [Number] // Processed in batch on the backend, 14 or however types we end up having
}, {collection: "HeatMaps"});

const RestrSchema = new mongoose.Schema({
    tp: Number, // type {0-13}
    an: Number, // angle
    st: Number, // start
    ed: Number, // end
    ds: [Boolean], // days in effect
    wk: [Boolean], // weeks in effect
    mn: [Boolean], // months in effect
    lt: Number, // limit
    pm: String, // permit
    ct: Number, // cost
    pr: Number, // per
    mo: Boolean, // motorcycle parking space
    up: Number, // upVotes
    dn: Number, // downVotes
    by: String, // by user id
    ud: mongoose.SchemaTypes.Date // updatedOn
}, {usePushEach: true});

const MapLineSchema = new mongoose.Schema({
    loc: {
        type: mongoose.Schema.Types.LineString,
        index: "2dsphere"
    },
    restrs_length: {
        type: Number,
        default: 0
    },
    restrs: {
        type: [RestrSchema],
        default: []
    }
}, {usePushEach: true});

const MapLineWithoutParentsSchema = new mongoose.Schema({
    loc: {
        type: mongoose.Schema.Types.LineString,
        index: "2dsphere"
    },
    restrs_length: {
        type: Number,
        default: 0
    },
    restrs: {
        type: [RestrSchema],
        default: []
    }
}, {
    collection: "Lines",
    usePushEach: true
});

const MapLineParentSchema = new mongoose.Schema({
    local_map_code: String, // i.e. CAMS id
    loc: {
        type: mongoose.Schema.Types.LineString,
        index: "2dsphere"
    },
    fullname: String,
    status: String,
    type: String,
    city: String,
    from: Number,
    to: Number,
    zip: Number,
    total_types: {
        type: Number,
        default: 0
    },
    types_each: [Number], // Processed in batch on the backend, 14 or however types we end up having
    lines_length: {
        type: Number,
        default: 0
    },
    lines: {
        type: [MapLineSchema],
        default: []
    }
}, {
    collection: "MapLines",
    usePushEach: true
});

const MapLineParents = mongoose.model("MapLines", MapLineParentSchema);
const MapLinesWithoutParents = mongoose.model("Lines", MapLineWithoutParentsSchema);
const HeatMaps = mongoose.model("HeatMaps", HeatMapSchema);
mongoose.connect(uri, {
    user: process.env.MAPDB_USERNAME,
    pass: process.env.MAPDB_PASSWORD,

    useMongoClient: true
});
module.exports = {
    parents: MapLineParents,
    linesWithoutParents: MapLinesWithoutParents,
    obj_id: mongoose.Types.ObjectId
};
