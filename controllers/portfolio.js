var User = require('../models/User');
var Portfolio = require('../models/Portfolio');
var Transaction = require('../models/Transaction');
var TickerController = require('../controllers/ticker.js');

/**
 * GET /portfolio
 * For now, gets the first portfolio grabbed from the database
 * owned by the current user. When multiple portfolios are implemented,
 * this will need to be changed.
 */
exports.home = async function (req, res) {
  let portfolio;
  try {
    portfolio = await new Portfolio().where('userId', req.user.attributes.id).fetch();
  } catch (err) {
    const msg = `Error in getting user's portfolio.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: 'Error' });
  }
  // Checking if the user has a portfolio. If not, create one.
  if (!portfolio) {
    try {
      portfolio = await new Portfolio({
        userId: req.user.attributes.id
      }).save()
    } catch (err) {
      const msg = `Error when creating new portfolio for user.`;
      console.error(msg);
      console.error(err);
      return res.render(`error`, { msg, title: 'Error' });
    }
    req.flash('success', { msg: `We noticed that you didn't have a portfolio yet. No worries, we created one for you!` });
  }

  // Grabbing the 5 most recent transactions.
  let transactions;
  let securityNames;
  try {
    transactions = await new Transaction().where('portfolioId', portfolio.id).orderBy('dateTransacted', 'DESC').fetchPage({ pageSize: 5, page: 1 });
    transactions = transactions.models.map(x => x.attributes);
    securityNames = await getSecurityNames(transactions.map(x => x.ticker));
  } catch (err) {
    const msg = `Error when grabbing transactions for portfolio.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: 'Error' });
  }
  return res.render('portfolio/portfolio.jade', {
    title: 'Portfolio',
    portfolioId: portfolio.attributes.id,
    transactions: transactions,
    securityNames: securityNames,
    darkTheme: (req.user) ? req.user['attributes']['darkTheme'] : false
  });
};

// Helper function for checking if user has access to a portfolio.
// Checks for more than just access (i.e. validity of the inputs).
async function hasPortfolioAccess(userId, portfolioId) {
  if (userId == undefined || portfolioId == undefined) {
    return false;
  }
  let portfolio;
  try {
    portfolio = await new Portfolio({ userId: userId, id: portfolioId }).fetch();
  } catch (err) {
    console.error(err);
    return false;
  }
  if (portfolio != null) {
    return true;
  } else {
    return false;
  }
}

// Helper function for checking if user has access to a transaction.
// Access to a transaction requires access to the portfolio the user
// is trying to access. Note that this function calls hasPortfolioAccess().
// Checks for more than just access (i.e. validity of the inputs).
async function hasTransactionAccess(userId, portfolioId, transactionId) {
  let hasPortfolioAccessBool;
  try {
    hasPortfolioAccessBool = await hasPortfolioAccess(userId, portfolioId);
  } catch (err) {
    console.error(err);
    return false;
  }
  if (!hasPortfolioAccessBool) {
    return false;
  }
  if (transactionId) { // editing existing transaction
    let transactionStatus;
    try {
      transactionStatus = await new Transaction({ id: transactionId, portfolioId: portfolioId }).fetch();
    } catch (err) {
      console.error(err);
      return false;
    }
    if (transactionStatus == null) { // transaction does not exist; deny access
      return false;
    }
    return true; // transaction does exist and user does have access
  } else { // creating new transaction
    return true;
  }
}

/**
 * GET /portfolio/:portfolioId/transactions
 * 
 * This function shows all of a portfolio's transactions.
 */
exports.editPortfolio = async function (req, res) {
  // Begin access check block
  let hasAccess = false;
  try {
    hasAccess = await hasPortfolioAccess(req.user.attributes.id, req.params.portfolioId);
  } catch (err) {
    console.error(err);
    return res.render('error', { msg: `An error occured while evaluating your right to see this page.` });
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to see this portfolio.` });
  }
  // End access check block

  let transactions;
  let securityNames;
  try {
    transactions = await new Transaction().where('portfolioId', req.params.portfolioId).orderBy('dateTransacted', 'DESC').fetchAll();
    transactions = transactions.models.map(x => x.attributes);
    securityNames = await getSecurityNames(transactions.map(x => x.ticker));
  } catch (err) {
    const msg = `Error when grabbing transactions for portfolio.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: 'Error' });
  }
  return res.render(`portfolio/edit_portfolio`, {
    title: `Edit Portfolio`,
    portfolioId: req.params.portfolioId,
    transactions: transactions,
    securityNames: securityNames,
    darkTheme: (req.user) ? req.user['attributes']['darkTheme'] : false
  });
};

/**
 * Helper function for getting the names of each of the tickers passed in.
 * Outputs result is an Object where:
 * key = ticker
 * value = name
 */
async function getSecurityNames(tickers) {
  // .map and .forEach creates some really esoteric scope issues and I didn't
  // want to solve that when a for-loop works just fine.
  let securityNames = {};
  for (let i = 0; i < tickers.length; i++) {
    if (!securityNames.hasOwnProperty(tickers[i])) {
      securityNames[tickers[i]] = await TickerController.yahooNameExchangeGet(tickers[i]);
      securityNames[tickers[i]] = securityNames[tickers[i]].name;
    }
  }
  return securityNames;
}

/* 
 * GET /portfolio/:portfolioId/transaction/edit
 * GET /portfolio/:portfolioId/transaction/edit/:transactionId
 * 
 * The first endpoint is for creating a new transaction.
 * The second endpoint is for modifying an existing transaction.
 * 
 * This function does not actually modify the data. 
 */
exports.editTransactionGet = async function (req, res) {
  // Begin access check block
  let hasAccess = false;
  try {
    hasAccess = await hasTransactionAccess(req.user.attributes.id, req.params.portfolioId, req.params.transactionId);
  } catch (err) {
    console.error(err);
    return res.render('error', { msg: `An error occured while evaluating your right to see this page.`, title: 'Error' });
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error' });
  }
  // End access check block

  if (req.params.transactionId) { // editing existing transaction
    let transaction;
    try {
      transaction = await new Transaction({ id: req.params.transactionId }).fetch();
      yahooName = await TickerController.yahooNameExchangeGet(transaction.attributes.ticker);
    } catch (err) {
      const msg = `An error occured while getting the transaction to be edited.`;
      console.error(msg);
      console.error(err);
      return res.render(`error`, { msg, title: `Error` });
    }
    return res.render(`portfolio/edit_transaction`, {
      title: `Add Transaction`,
      portfolioId: req.params.portfolioId,
      transaction: transaction.attributes,
      yahooName: `${transaction.attributes.ticker} - ${yahooName.name}`,
      darkTheme: (req.user) ? req.user['attributes']['darkTheme'] : false
    });
  } else { // creating new transaction
    return res.render(`portfolio/edit_transaction`, {
      title: `Add Transaction`,
      portfolioId: req.params.portfolioId,
      transaction: undefined,
      darkTheme: (req.user) ? req.user['attributes']['darkTheme'] : false
    });
  }
};

/**
 * POST /portfolio/:portfolioId/transaction/edit
 * 
 * This function is what modifies the data.
 */
exports.editTransactionPost = async function (req, res) {
  // Begin access check block
  let hasAccess = false;
  try {
    hasAccess = await hasTransactionAccess(req.user.attributes.id, req.params.portfolioId, req.params.transactionId);
  } catch (err) {
    console.error(err);
    return res.render('error', { msg: `An error occured while evaluating your right to see this page.`, title: 'Error' });
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error' });
  }
  // End access check block

  req.assert('action', `You must select one of the 'Action' choices.`).action_type();
  req.assert('date', 'You must enter a valid date.').isDate();
  // I should validate the ticker here but as it turns out, it's really, really
  // hard to do async validations. So, client-side validation only it is. 
  req.assert('value', `Value must be numeric, have at most 2 decimal places, and be less than $99,999,999.99.`).isDecimal({ decimal_digits: 2 }).isFloat({ min: 0, max: 99999999.99 });
  req.assert('shares', `Shares must be numeric, be greater than 0, and have at most 4 decimal places, and be less than 99,999,999.9999.`).isDecimal({ decimal_digits: 4 }).isFloat({ min: 0.0001, max: 99999999.9999 });

  let errors = req.validationErrors();
  if (errors) {
    req.flash('error', errors);
    return res.render('portfolio/edit_transaction', {
      portfolioId: req.body.portfolioId,
      title: 'Edit Transaction',
      darkTheme: (req.user) ? req.user['attributes']['darkTheme'] : false
    });
  }
  let transaction;
  try {
    transaction = new Transaction({
      userId: req.user.attributes.id,
      portfolioId: req.body.portfolioId,
      ticker: req.body.ticker,
      type: req.body.action,
      dateTransacted: req.body.date,
      numShares: req.body.shares,
      value: req.body.value
    });
    if (req.body.transactionId) {
      transaction['id'] = req.body.transactionId;
    }
    transaction = await transaction.save();
  } catch (err) {
    const msg = `An error occured while adding or editing a transaction.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: `Error` });
  }
  req.flash('success', { msg: 'Your transaction has been added/modified.' })
  return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
};

/* 
 * POST /portfolio/:portfolioId/transaction/delete/:transactionId
 */
exports.deleteTransaction = async function (req, res) {
  // Begin access check block
  let hasAccess = false;
  try {
    hasAccess = await hasTransactionAccess(req.user.attributes.id, req.params.portfolioId, req.params.transactionId);
  } catch (err) {
    console.error(err);
    return res.render('error', { msg: `An error occured while evaluating your right to perform this action.`, title: 'Error' });
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to delete this transaction.`, title: 'Error' });
  }
  // End access check block

  let transaction;
  try {
    transaction = new Transaction({ id: req.params.transactionId }).destroy()
  } catch (err) {
    const msg = `An error occured while deleting the transaction.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: `Error` });
  }
  req.flash('success', { msg: 'Your transaction has been deleted.' });
  return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
};