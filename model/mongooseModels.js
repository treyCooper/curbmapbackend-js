'use strict';
const mongoose = require('mongoose');
const GeoJSON = require('mongoose-geojson-schema');
require('dotenv').config({path: '../curbmap.env'});
const uri = 'mongodb://' + process.env.MONGO_SHARD_0 + ',' + process.env.MONGO_SHARD_1 + ',' + process.env.MONGO_SHARD_2 +
        '/' + process.env.MONGO_DB + '?ssl=true';
mongoose.connect(uri, {
  user: process.env.MAPDB_USERNAME,
  pass: process.env.MAPDB_PASSWORD,
  auth: {
    authdb: 'admin'
  },
  replset: { rs_name: process.env.MONGO_REPLSET }
});
// mongoose.connect(uri);
mongoose.Promise = require('bluebird');

const RestrSchema = new mongoose.Schema({
  "i": String,    // id
  "t": String,    // type
  "d": [Boolean], // days
  "s": Number,    // start
  "e": Number,    // end
  "u": Number,    // updatedOn
  "b": String,    // by user id
  "c": Number,    // cost
  "l": Number,    // limit
  "p": Number,    // per
  "an": Number,   // angle
  "up": Number,   // upVotes
  "dn": Number    // downVotes
});

const PointsSchema = new mongoose.Schema({
  "point_id": {
    type: mongoose.Schema.Types.ObjectId,
    default: function () {
      return new ObjectId()
    },
    required: true,
    auto: true,
  },
  "point": [Number, Number],
  "restrs": [RestrSchema]
});

const MapLineSchema = new mongoose.Schema({
  "gid": Number,
  "cams_id": Number,
  "fullname": String,
  "status": String,
  "type": String,
  "city_l": String,
  "from_l": Number,
  "to_l": Number,
  "zip_l": Number,
  "city_r": String,
  "from_r": Number,
  "to_r": Number,
  "zip_r": Number,
  "odd_l": Boolean,
  "loc": {type: mongoose.Schema.Types.LineString, index: '2dsphere'},
  "points": [PointsSchema],
  "restrs": [RestrSchema]
}, {collection: 'MapLines'});

const MapLines = mongoose.model('MapLines', MapLineSchema);
const Points = mongoose.model('Points', PointsSchema);
const Restrs = mongoose.model('Restrs', RestrSchema);

module.exports = {
  model : MapLines,
  points: Points,
  restrs: Restrs
}
