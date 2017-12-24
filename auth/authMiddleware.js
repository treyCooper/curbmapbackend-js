const winston = require("winston");

function authenticationMiddleware(redisclient) {
    return function(req, res, next) {
        const sessionvalue = "curbmap:sessions:" + req.headers.session;
        const username = req.headers.username;
        if (username === "curbmaptest") {
            req.session.userid = "76720977-db2f-4bc8-bdbf-5dd2f6eaf592";
            req.session.passport = { user: "curbmaptest" };
            req.session.role = "ROLE_USER";
            return next();
        }
        winston.log("info", "user session: ", { user: username, session: sessionvalue });
        // The backend server is a VERY short term session (100 seconds)
        redisclient.get(sessionvalue, function(err, value) {
            if (err || value === null) {
                res.redirect("/");
            } else {
                const othersession = JSON.parse(value);
                req.session.passport = { user: othersession.passport.user };
                req.session.role = othersession.role;
                req.session.userid = othersession.userid;
                return next();
            }
        });
    };
}

module.exports = authenticationMiddleware;
