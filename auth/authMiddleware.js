function authenticationMiddleware (redisclient) {
    return function (req, res, next) {
        const sessionvalue = 'curbmap:sessions:'+req.headers.session;
        // The backend server is a VERY short term session (100 seconds)
        redisclient.get(sessionvalue, function (err, value) {
            if (err || value === null) {
                res.redirect('/');
            } else {
                const othersession = JSON.parse(value);
                req.session.passport = {user: othersession.passport.user};
                req.session.role = othersession.role;
                req.session.userid = othersession.userid;
                return next();
            }
        });
    }
}

module.exports = authenticationMiddleware;
