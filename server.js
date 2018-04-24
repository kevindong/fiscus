var express = require('express');
var sslRedirect = require('heroku-ssl-redirect');
var path = require('path');
var logger = require('morgan');
var compression = require('compression');
var methodOverride = require('method-override');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var flash = require('express-flash');
var bodyParser = require('body-parser');
var expressValidator = require('express-validator');
var dotenv = require('dotenv');
var passport = require('passport');
const rp = require('request-promise');
const fileUpload = require('express-fileupload');

// Load environment variables from .env file
dotenv.load();

// Controllers
var adminController = require('./controllers/admin');
var userController = require('./controllers/user');
var tickerController = require('./controllers/ticker');
var splashController = require('./controllers/splash');
var portfolioController = require('./controllers/portfolio');
var watchlistController = require('./controllers/watchlist');

// Passport OAuth strategies
require('./config/passport');

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.set('port', process.env.PORT || 3000);
app.use(sslRedirect());
app.use(compression());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// For custom validators:
// true  === pass validation; approve
// false === fail validation; reject
const customValidators = {
  action_type: function (val) {
    let found = false;
    ['Buy', 'Sell', 'Cover', 'Short', 'Deposit Cash', 'Withdraw Cash'].forEach((x) => {
      if (x === val) {
        found = true;
      }
    })
    return found;
  }
};
app.use(expressValidator({ customValidators }));
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  store: new RedisStore({
    url: process.env.REDIS_URL
  })
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
app.use(function (req, res, next) {
  res.locals.user = req.user ? req.user.toJSON() : null;
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// boilerplate routes
app.get('/', splashController.index);
app.get('/account', userController.ensureAuthenticated, userController.accountGet);
app.put('/account', userController.ensureAuthenticated, userController.accountPut);
app.delete('/account', userController.ensureAuthenticated, userController.accountDelete);
app.get('/signup', userController.signupGet);
app.post('/signup', userController.signupPost);
app.get('/confirm/:token', userController.confirmGet);
app.get('/login', userController.loginGet);
app.post('/login', userController.loginPost);
app.get('/forgot', userController.forgotGet);
app.post('/forgot', userController.forgotPost);
app.get('/reset/:token', userController.resetGet);
app.post('/reset/:token', userController.resetPost);
app.get('/logout', userController.logout);

// dark theme
app.get('/invert', userController.invertTheme);

// toggle margins
app.get('/margins', userController.toggleMargins);

// ticker routes
app.get('/ticker/details/:ticker', tickerController.tickerDetailsGet);
app.get('/ticker/lookup', tickerController.lookupTickerGet);

// admin console routes
app.get('/admin', adminController.ensureAuthenticated, adminController.index);
app.post('/admin/banUser', adminController.ensureAuthenticated, adminController.banUser);
app.post('/admin/unbanUser', adminController.ensureAuthenticated, adminController.unbanUser);
app.post('/admin/deleteUser', adminController.ensureAuthenticated, adminController.deleteUser);
app.post('/admin/email/:user_email', adminController.ensureAuthenticated, adminController.emailUser);
app.post('/admin/emailAll', adminController.ensureAuthenticated, adminController.emailAll);
app.post('/admin/resetAll', adminController.ensureAuthenticated, adminController.resetAll);

// portfolio
app.get('/portfolio', userController.ensureAuthenticated, portfolioController.home);
app.get('/portfolio/:portfolioId/transactions', userController.ensureAuthenticated, portfolioController.editPortfolio);
app.get('/portfolio/:portfolioId/transaction/edit', userController.ensureAuthenticated, portfolioController.editTransactionGet);
app.get('/portfolio/:portfolioId/transaction/edit/:transactionId', userController.ensureAuthenticated, portfolioController.editTransactionGet);
app.post('/portfolio/:portfolioId/transaction/edit', userController.ensureAuthenticated, portfolioController.editTransactionPost);
app.post('/portfolio/:portfolioId/transaction/delete/:transactionId', userController.ensureAuthenticated, portfolioController.deleteTransaction);
app.get('/portfolio/:portfolioId/transaction/export', userController.ensureAuthenticated, portfolioController.exportTransaction)
app.post('/portfolio/:portfolioId/transaction/import', userController.ensureAuthenticated, portfolioController.importTransaction)

// watchlist
app.get('/watchlist', userController.ensureAuthenticated, watchlistController.watchlistGet);
app.post('/watchlist/add', userController.ensureAuthenticated, watchlistController.watchlistAdd);
app.get('/watchlist/:itemId/delete', userController.ensureAuthenticated, watchlistController.watchlistDelete);

// Production error handler
if (app.get('env') === 'production') {
  app.use(function (err, req, res, next) {
    console.error(err.stack);
    res.sendStatus(err.status || 500);
  });
}

app.listen(app.get('port'), function () {
  console.log('Express server listening on port ' + app.get('port'));
});

module.exports = app;
