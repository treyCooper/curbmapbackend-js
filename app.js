"use strict";
require("dotenv").config({ path: "../curbmap.env" });
const express = require("express");
const path = require("path");
const logger = require("morgan");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const fs = require("fs");
const cors = require("cors");
const compression = require("compression");
const winston = require("winston");
const bcrypt = require("bcrypt");
const passportJWT = require("passport-jwt");
const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;
const TOKEN_KEY = fs.readFileSync("../curbmap.pub");
var app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

// CORS setup
var whitelist = [
  "http://localhost:8080",
  "https://curbmap.com",
  "https://curbmap.com:443",
  "http://curbmap.com:8080",
  "http://localhost:3000",
  "*"
];
var corsOptions = {
  origin: function(origin, callback) {
    winston.log("info", "origin: ", origin);
    if (whitelist.indexOf("*") !== -1 || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }
};

app.options("*", cors(corsOptions)); // include before other routes
app.use(cors(corsOptions));
app.use(compression());
app.use(logger("dev"));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
// routes can also get the body
app.use(express.static(path.join(__dirname, "public")));

function shouldCompress(req, res) {
  if (req.headers["x-no-compression"]) {
    // don't compress responses with this request header
    return false;
  }

  // fallback to standard filter function
  return compression.filter(req, res);
}

app.use(passport.initialize());

passport.serializeUser(function(user, cb) {
  cb(null, user.username);
});

passport.deserializeUser(function(username, cb) {
  findUser(username, cb);
});

// We will add other Strategies, such as FB strategy
passport.use(
  new JWTStrategy(
    {
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      secretOrKey: TOKEN_KEY,
      algorithms: ["RS384"]
    },
    (jwtPayload, cb) => {
      return cb(null, jwtPayload);
    }
  )
);
const main = require("./routes/main")
app.use("/", main);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
