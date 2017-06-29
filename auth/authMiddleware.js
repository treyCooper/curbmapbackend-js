function authenticationMiddleware (redisclient) {
    return function (req, res, next) {
        var found = false;
        var sessionvalue = 'curbmap:sessions:'+req.headers.session;
        // The backend server is a VERY short term session (100 seconds)
        redisclient.get(sessionvalue, function (err, value) {
            if (err || value === null) {
                res.redirect('/');
            } else {
                var othersession = JSON.parse(value);
                req.session.passport = {user: othersession.passport.user};
                req.session.role = othersession.role;
                req.session.userid = othersession.userid;
                found = true;
                return next();
            }
        });
    }
}

module.exports = authenticationMiddleware;