const async = require('async');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const passport = require('passport');
const request = require('request');
const User = require('../models/User');

/**
 * Login required middleware specifically for admins
 */
exports.ensureAuthenticated = (req, res, next) => {
    if (!req.isAuthenticated()) {
        res.redirect('/login');
    } else if (req.user['attributes']['isBanned']) {
        req.flash('error', { msg: 'Your account has been suspended.' });
        res.redirect('/login');
    } else if (!req.user['attributes']['isAdmin']) {
        req.flash('error', { msg: 'You don\'t have permission to access the admin console.' });
        res.redirect('/login');
    } else {
        next();
    }
};

/**
 * GET /admin
 */
exports.index = (req, res) => {
    new User().orderBy('id').fetchAll().then(users => {
        res.render('admin', {
            title: 'Admin',
            users: users.map(user => user.attributes)
        });
    });
};

/**
 * POST /admin/banUser
 */
exports.banUser = (req, res) => {
    new User().where('id', req.body.userId).fetch().then(user => {
        user.set('isBanned', true);
        user.save();
    }).then(user => {
        req.flash('success', { msg: 'User was banned.' })
        res.redirect('/admin');
    }).catch(error => {
        req.flash('error', { msg: 'An error occured while banning the user.' })
        res.redirect('/admin');
    });
};

/**
 * POST /admin/unbanUser
 */
exports.unbanUser = (req, res) => {
    new User().where('id', req.body.userId).fetch().then(user => {
        user.set('isBanned', false);
        user.save();
    }).then(user => {
        req.flash('success', { msg: 'User was unbanned.' })
        res.redirect('/admin');
    }).catch(error => {
        req.flash('error', { msg: 'An error occured while unbanning the user.' })
        res.redirect('/admin');
    });
};

/**
 * POST /admin/deleteUser
 */
exports.deleteUser = (req, res, next) => {
    new User({ id: req.body.userId }).destroy()
        .then(user => {
            req.flash('success', { msg: 'The selected user has been deleted.' });
            res.redirect('/admin');
        })
        .catch(error => {
            req.flash('error', { msg: 'An error occured while deleting the selected user.' });
            res.redirect('/admin');
        });
};

/**
 * POST /admin/email/:user_email
 */
exports.emailUser = (req, res) => {
    const transporter = nodemailer.createTransport({
        service: 'Mailgun',
        auth: {
            user: process.env.MAILGUN_USERNAME,
            pass: process.env.MAILGUN_PASSWORD
        }
    });
    transporter.sendMail({
        to: req.params.user_email,
        from: 'noreply-fiscus@purdue.edu',
        subject: req.body.subject,
        text: req.body.text
    }, err => {
        if (err) {
            console.error(err);
            req.flash('error', { msg: 'There was an error sending your email.' });
            return res.redirect('/admin');
        }
        req.flash('info', { msg: 'Your email has been sent to ' + req.params.user_email });
        res.redirect('/admin');
    });
};

/**
 * POST /admin/emailAll
 */
exports.emailAll = (req, res) => {
    const transporter = nodemailer.createTransport({
        service: 'Mailgun',
        auth: {
            user: process.env.MAILGUN_USERNAME,
            pass: process.env.MAILGUN_PASSWORD
        }
    });
    new User().orderBy('id')
        .fetchAll()
        .then(users => {
            users.forEach(user => {
                transporter.sendMail({
                    to: user.attributes.email,
                    from: 'noreply-fiscus@purdue.edu',
                    subject: req.body.subject,
                    text: req.body.text
                }, err => {
                    if (err) {
                        console.error(err);
                        req.flash('error', { msg: 'Could not send mail to ' + user.attributes.email + '.' });
                    }
                });
            });
            req.flash('info', { msg: 'Emailed all users' });
            res.redirect('/admin');
        });
};

/**
 * POST /admin/resetAll
 */
exports.resetAll = (req, res, next) => {
    User.fetchAll().then(users => {
        users.forEach(user => {
            request.post({
                url: req.protocol + '://' + req.get('host') + '/forgot',
                form: {
                    email: user['attributes']['email'],
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            });
        }, this);
        req.flash('success', { msg: 'All passwords have been reset.' });
        res.redirect('/admin');
    }).catch(error => {
        req.flash('error', { msg: 'An error occured while resetting the passwords.' })
        res.redirect('/admin');
    });
};