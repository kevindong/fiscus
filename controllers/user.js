var async = require('async');
var crypto = require('crypto');
var nodemailer = require('nodemailer');
var passport = require('passport');
var User = require('../models/User');

/**
 * Login required middleware
 */
exports.ensureAuthenticated = function (req, res, next) {
  if (!req.isAuthenticated()) {
    res.redirect('/login');
  } else if (req.user['attributes']['isBanned']) {
    req.flash('error', { msg: 'Your account has been suspended.' });
    res.redirect('/login');
  } else {
    next();
  }
};

/**
 * GET /login
 */
exports.loginGet = function (req, res) {
  if (req.user) {
    return res.redirect('/');
  }
  res.render('account/login', {
    title: 'Log in'
  });
};

/**
 * POST /login
 */
exports.loginPost = function (req, res, next) {
  req.assert('email', 'Email is not valid').isEmail();
  req.assert('email', 'Email cannot be blank').notEmpty();
  req.assert('password', 'Password cannot be blank').notEmpty();
  req.sanitize('email').normalizeEmail({ remove_dots: false });

  var errors = req.validationErrors();

  if (errors) {
    req.flash('error', errors);
    return res.redirect('/login');
  }

  passport.authenticate('local', function (err, user, info) {
    if (!user) {
      req.flash('error', info);
      return res.redirect('/login')
    }
    req.logIn(user, function (err) {
      res.redirect('/');
    });
  })(req, res, next);
};

/**
 * GET /logout
 */
exports.logout = function (req, res) {
  req.logout();
  res.redirect('/');
};

/**
 * GET /signup
 */
exports.signupGet = function (req, res) {
  if (req.user) {
    return res.redirect('/');
  }
  res.render('account/signup', {
    title: 'Sign up'
  });
};

/**
 * GET /confirm/:token
 */
exports.confirmGet = function (req, res) {
  if (req.user || !req.params.token) {
    return res.redirect('/');
  }
  const user = new User({ emailToken: req.params.token })
    .fetch()
    .then(function (user) {
      user.save({ isConfirmed: true }, { patch: true })
      req.logIn(user, function (err) {
        req.flash('info', { msg: 'You\'ve successfully confirmed your account.' });
        res.redirect('/');
      })
    })
    .catch(function (err) {
      req.flash('error', { msg: 'There was a problem confirming your account.' });
      return res.redirect('/')
    });
}

/**
 * POST /signup
 */
exports.signupPost = function (req, res, next) {
  req.assert('name', 'Name cannot be blank').notEmpty();
  req.assert('email', 'Email is not valid').isEmail();
  req.assert('email', 'Email cannot be blank').notEmpty();
  req.assert('password', 'Password must be at least 4 characters long').len(4);
  req.sanitize('email').normalizeEmail({ remove_dots: false });

  var errors = req.validationErrors();

  if (errors) {
    req.flash('error', errors);
    return res.redirect('/signup');
  }

  const emailAuthToken = crypto.randomBytes(16).toString('hex');
  new User({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    emailToken: emailAuthToken,
    isAdmin: false,
    isBanned: false,
    isConfirmed: false
  }).save()
    .then(function (user) {
      //Send the verification email
      var transporter = nodemailer.createTransport({
        service: 'Mailgun',
        auth: {
          user: process.env.MAILGUN_USERNAME,
          pass: process.env.MAILGUN_PASSWORD
        }
      });
      var mailOptions = {
        to: user.attributes.email,
        from: 'noreply-fiscus@purdue.edu',
        subject: 'Confirm your account on Fiscus',
        text: ` Welcome to Fiscus! 💰💰💰 Please confirm your account by visiting http://${req.headers.host}/confirm/${encodeURIComponent(emailAuthToken)}.`
      };
      transporter.sendMail(mailOptions, function (err) {
        if (err) {
          console.error(err);
          req.flash('error', { msg: 'There was an error sending your email.' });
          return res.redirect('/');
        }
        req.flash('info', { msg: `An email has been sent to ${user.attributes.email} with further instructions.` });
        res.redirect('/');
      });
    })
    .catch(function (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.code === '23505') {
        req.flash('error', { msg: 'The email address you have entered is already associated with another account.' });
        return res.redirect('/signup');
      } else {
        console.error(err);
        req.flash('error', { msg: 'Unknown error.' });
        return res.redirect('/signup');
      }
    });
};

/**
 * GET /account
 */
exports.accountGet = function (req, res) {
  res.render('account/profile', {
    title: 'My Account',
    darkTheme: req.user['attributes']['darkTheme']
  });
};

/**
 * PUT /account
 * Update profile information OR change password.
 */
exports.accountPut = function (req, res, next) {
  if ("password" in req.body) {
    req
      .assert("password", "Password must be at least 4 characters long")
      .len(4);
    req.assert("confirm", "Passwords must match").equals(req.body.password);
  } else {
    req.assert("email", "Email is not valid").isEmail();
    req.assert("email", "Email cannot be blank").notEmpty();
    req.sanitize("email").normalizeEmail({ remove_dots: false });
  }

  const errors = req.validationErrors();

  if (errors) {
    req.flash("error", errors);
    return res.redirect("/account");
  }

  let d = {
    email: req.body.email,
    name: req.body.name,
    gender: req.body.gender,
    location: req.body.location,
    website: req.body.website
  };
  if ("password" in req.body) {
    d = { password: req.body.password };
  }

  const user = new User({ id: req.user.id });

  user.save(d, { patch: true })
    .then(() => {
      if ("password" in req.body) {
        req.flash("success", { msg: "Your password has been changed." });
      } else {
        req.flash("success", {
          msg: "Your profile information has been updated."
        });
      }
      res.redirect("/account");
    })
    .catch(err => {
      if (err.code === "ER_DUP_ENTRY") {
        req.flash("error", {
          msg: "The email address you have entered is already associated with another account."
        });
      }
    });
};

/**
 * DELETE /account
 */
exports.accountDelete = function (req, res, next) {
  new User({ id: req.user.id }).destroy().then(function (user) {
    req.logout();
    req.flash('info', { msg: 'Your account has been permanently deleted.' });
    res.redirect('/');
  });
};

/**
 * GET /forgot
 */
exports.forgotGet = function (req, res) {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('account/forgot', {
    title: 'Forgot Password'
  });
};

/**
 * POST /forgot
 */
exports.forgotPost = function (req, res, next) {
  req.assert('email', 'Email is not valid').isEmail();
  req.assert('email', 'Email cannot be blank').notEmpty();
  req.sanitize('email').normalizeEmail({ remove_dots: false });

  var errors = req.validationErrors();

  if (errors) {
    req.flash('error', errors);
    return res.redirect('/forgot');
  }

  async.waterfall([
    function (done) {
      crypto.randomBytes(16, function (err, buf) {
        var token = buf.toString('hex');
        done(err, token);
      });
    },
    function (token, done) {
      new User({ email: req.body.email })
        .fetch()
        .then(function (user) {
          if (!user) {
            req.flash('error', { msg: 'The email address ' + req.body.email + ' is not associated with any account.' });
            return res.redirect('/forgot');
          }
          user.set('passwordResetToken', token);
          user.set('passwordResetExpires', new Date(Date.now() + 3600000)); // expire in 1 hour
          user.save(user.changed, { patch: true }).then(function () {
            done(null, token, user.toJSON());
          });
        });
    },
    function (token, user, done) {
      var transporter = nodemailer.createTransport({
        service: 'Mailgun',
        auth: {
          user: process.env.MAILGUN_USERNAME,
          pass: process.env.MAILGUN_PASSWORD
        }
      });
      var mailOptions = {
        to: user.email,
        from: 'noreply-fiscus@purdue.edu',
        subject: 'Reset your password on Fiscus',
        text: 'You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n' +
          'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
          'http://' + req.headers.host + '/reset/' + token + '\n\n' +
          'If you did not request this, please ignore this email and your password will remain unchanged.\n'
      };
      transporter.sendMail(mailOptions, function (err) {
        req.flash('info', { msg: 'An email has been sent to ' + user.email + ' with further instructions.' });
        res.redirect('/forgot');
      });
    }
  ]);
};

/**
 * GET /reset
 */
exports.resetGet = function (req, res) {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  new User({ passwordResetToken: req.params.token })
    .where('passwordResetExpires', '>', new Date())
    .fetch()
    .then(function (user) {
      if (!user) {
        req.flash('error', { msg: 'Password reset token is invalid or has expired.' });
        return res.redirect('/forgot');
      }
      res.render('account/reset', {
        title: 'Password Reset'
      });
    });
};

/**
 * POST /reset
 */
exports.resetPost = function (req, res, next) {
  req.assert('password', 'Password must be at least 4 characters long').len(4);
  req.assert('confirm', 'Passwords must match').equals(req.body.password);

  var errors = req.validationErrors();

  if (errors) {
    req.flash('error', errors);
    return res.redirect('back');
  }

  async.waterfall([
    function (done) {
      new User({ passwordResetToken: req.params.token })
        .where('passwordResetExpires', '>', new Date())
        .fetch()
        .then(function (user) {
          if (!user) {
            req.flash('error', { msg: 'Password reset token is invalid or has expired.' });
            return res.redirect('back');
          }
          user.set('password', req.body.password);
          user.set('passwordResetToken', null);
          user.set('passwordResetExpires', null);
          user.save(user.changed, { patch: true }).then(function () {
            req.logIn(user, function (err) {
              done(err, user.toJSON());
            });
          });
        });
    },
    function (user, done) {
      var transporter = nodemailer.createTransport({
        service: 'Mailgun',
        auth: {
          user: process.env.MAILGUN_USERNAME,
          pass: process.env.MAILGUN_PASSWORD
        }
      });
      var mailOptions = {
        from: 'noreply-fiscus@purdue.edu',
        to: user.email,
        subject: 'Your Fiscus password has been changed',
        text: 'Hello,\n\n' +
          'This is a confirmation that the password for your account ' + user.email + ' has just been changed.\n'
      };
      transporter.sendMail(mailOptions, function (err) {
        req.flash('success', { msg: 'Your password has been changed successfully.' });
        res.redirect('/account');
      });
    }
  ]);
};

/**
 * GET /invert
 */
exports.invertTheme = function (req, res) {
  const user = new User({ id: req.user.id });

  user.save({ darkTheme: !req.user.attributes['darkTheme'] }, { patch: true })
    .then(() => {
      if ("password" in req.body) {
        req.flash("success", { msg: "Your theme has been changed." });
      }
      res.redirect("/");
    })
    .catch(err => {
      req.flash("error", {
        msg: 'Something went wrong.'
      });
    });
};

/**
 * GET /margins
 */
exports.toggleMargins = function (req, res) {
  const user = new User({ id: req.user.id });

  user.save({ smallMargins: !req.user.attributes['smallMargins'] }, { patch: true })
    .then(() => {
      if ("password" in req.body) {
        req.flash("success", { msg: "Your margin size has been changed." });
      }
      res.redirect("/");
    })
    .catch(err => {
      req.flash("error", {
        msg: 'Something went wrong.'
      });
    });
};