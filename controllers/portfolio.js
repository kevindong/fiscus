var parse = require('csv-parse');
var path = require('path');
var os = require('os');
var fs = require('fs');

var User = require('../models/User');
var Portfolio = require('../models/Portfolio');
var CurrentSecurity = require('../models/CurrentSecurity');
var Transaction = require('../models/Transaction');
var TickerController = require('../controllers/ticker.js');
var CurrentSecurity = require('../models/CurrentSecurity');
const rp = require('request-promise');
const iextradingRoot = 'https://api.iextrading.com/1.0';

// Dividend Global Variables
let freshDividends = {};
let totalFreshValue = 0;
let unfilledDivs = {};
let recIndx = 0;


// Splits Global Variables
let freshSplits = {};
let unfilledSplits = {};
let splits = {};
let multiplier = 1;
let shareMultiplier = 1;



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

  // Getting stories about stocks in portfolio
  let currentHoldings;
  try {
    currentHoldings = await new CurrentSecurity().where('portfolioId', portfolio.id).fetchAll();
    currentHoldings = currentHoldings.models.map(x => x.attributes);
  } catch (err) {
    const msg = `Error when grabbing current holdings.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: 'Error' });
  }
  let currentHoldingsTickers = currentHoldings.map(x => x.ticker).filter(y => y != "$");
  let news = [];
  if (currentHoldingsTickers.length > 0) {
    try {
      let tickers = [];
      let headings = {};
      for (let i = 0; i < 6; i++) {
        let currStories = await TickerController.iexNews(currentHoldingsTickers[(Math.floor(Math.random() * currentHoldingsTickers.length))]);
        while (currStories.length != 0) {
          let candidate = currStories.shift();
          if (headings[candidate.headline] === undefined) {
            news.push(candidate);
            headings[candidate.headline] = true;
            break;
          }
        }
      }
    } catch (err) {
      // News stories is a non-critical feature. User will be shown page without stories. 
      console.error('Failed to grab news stories about portfolio.');
      console.error(err);
    }
  }



  // Get chart
  let portfolioChart;
  try {
    portfolioChart = await portfolioChartGet('1m', req.user.attributes.id);
  } catch (err) {
    const msg = 'Error when grabbing portfolio chart';
    console.log(msg);
    console.log(err);
    return res.render(`error`, {msg, title: 'Error'});
  }

  // Get current securities
  let currentSecurities;
  try {
    currentSecurities = await getCurrentSecurities(portfolio.id);

    //console.log(currentSecurities);
  } catch (err) {
    const msg = 'Error when grabbing current securities';
    console.log(msg);
    console.log(err);
    return res.render(`error`, {msg, title: 'Error'});
  }

  let chartColor;
  if(portfolioChart === null) {
    chartColor = null;
  } else {
    chartColor = (portfolioChart[portfolioChart.length - 1].y > 0) ? '#4CAF50' : '#F44336'
  }

  console.log(portfolioChart !== null);

  return res.render('portfolio/portfolio.jade', {
    title: 'Portfolio',
    portfolioId: portfolio.attributes.id,
    transactions: transactions,
    securityNames: securityNames,
    validChart: (portfolioChart !== null),
    portfolioChart: JSON.stringify(portfolioChart),
    currentSecurities: currentSecurities,
    chartColor: JSON.stringify(chartColor),
    news: news
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
    return res.render('error', {msg: `An error occurred while evaluating your right to see this page.`});
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
    securityNames: securityNames
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

exports.getSecurityNames = getSecurityNames;

/**
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
    return res.render('error', {msg: `An error occurred while evaluating your right to see this page.`, title: 'Error'});
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
      msg: undefined
    });
  } else { // creating new transaction
    return res.render(`portfolio/edit_transaction`, {
      title: `Add Transaction`,
      portfolioId: req.params.portfolioId,
      transaction: undefined,
      msg: undefined
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
    return res.render('error', {msg: `An error occurred while evaluating your right to see this page.`, title: 'Error'});
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error' });
  }
  // End access check block

  req.assert('action', `You must select one of the 'Action' choices.`).action_type();
  req.assert('date', 'You must enter a valid date.').isDate();
  // I should validate the ticker here but as it turns out, it's really, really
  // hard to do async validations. So, client-side validation only it is. 
  req.assert('value', `Value must be numeric, have at most 2 decimal places, and be less than $99,999,999.99.`).isDecimal({decimal_digits: 2}).isFloat({min: 0, max: 99999999.99});
  if (req.body.action.indexOf('Cash') == -1) {
    req.assert('shares', `Shares must be numeric, be greater than 0, and have at most 4 decimal places, and be less than 99,999,999.9999.`).isDecimal({decimal_digits: 4}).isFloat({min: 0.0001, max: 99999999.9999});
  } else {
    req.body.deductFromCash = true;
    req.body.ticker = '$';
    req.body.shares = req.body.value;
  }

  let errors = req.validationErrors();
  if (errors) {
    req.flash('error', errors);
    return res.render('portfolio/edit_transaction', {
      portfolioId: req.body.portfolioId,
      title: 'Edit Transaction'
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
      value: req.body.value,
      deductFromCash: (req.body.deductFromCash === 'true')
    });

    if (req.body.transactionId) {
      await editTransaction(transaction, req.body.transactionId, req.user.attributes.id);
      //transaction['id'] = req.body.transactionId;
    } else {
      await addTransaction(transaction, req.user.attributes.id);
    }
    //transaction = await transaction.save();
  } catch (err) {
    const msg = `An error occurred while adding or editing a transaction.`;
    console.error(msg);
    console.error(err);
    if (req.body.transactionId) { // editing existing transaction
      let transaction;
      try {
        transaction = await new Transaction({ id: req.body.transactionId }).fetch();
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
        msg: err
      });
    } else { // creating new transaction
      return res.render(`portfolio/edit_transaction`, {
        title: `Add Transaction`,
        portfolioId: req.params.portfolioId,
        transaction: undefined,
        msg: err
      });
    }
  }

  req.flash('success', {msg: 'Your transaction has been added/modified.'});
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
    return res.render('error', {msg: `An error occurred while evaluating your right to perform this action.`, title: 'Error'});
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to delete this transaction.`, title: 'Error' });
  }
  // End access check block

  let transaction;
  try {
    await deleteTransaction(req.params.transactionId, req.user.attributes.id);
  } catch (err) {
    const msg = `An error occurred while deleting the transaction.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: `Error` });
  }
  req.flash('success', { msg: 'Your transaction has been deleted.' });
  return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
};



// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ Begin Portfolio Adjustment Code ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


async function addTransaction(transaction, userId) {
  // Check if updatePortfolio works
  try{
    await updatePortfolioValue(transaction, userId);
    await updateDividends(transaction, userId);
  } catch(err) {
    throw err;
  }




  // Save transaction if it does
  await transaction.save()
}


/**
 * Edit an existing transaction
 *
 * @param transaction
 * @param oldId
 * @param userId
 * @returns {Promise.<void>}
 */
async function editTransaction(transaction, oldId, userId) {

  // Create canceling transaction
  let oldTransaction = await new Transaction({id: oldId}).fetch();

  if(!oldTransaction) {
    throw 'Could not find transaction to delete';
  }

  let oldCopy = oldTransaction.toJSON();

  let newType;

  switch(oldTransaction.attributes.type) {
    case 'Buy':
      newType = 'Sell';
      break;
    case 'Sell':
      newType = 'Buy';
      break;
    case 'Short':
      newType = 'Cover';
      break;
    case 'Cover':
      newType = 'Short';
      break;
  }


  let cancelTrans= new Transaction({
    ticker: oldTransaction.attributes.ticker,
    type: newType,
    dateTransacted: formatDate(oldTransaction.attributes.dateTransacted),
    numShares: oldTransaction.attributes.numShares,
    value: oldTransaction.attributes.value,
    deductFromCash: oldTransaction.attributes.deductFromCash
  });

  try {
    await updatePortfolioValue(cancelTrans, userId);
    await updateDividends(cancelTrans, userId);
  } catch(err) {
    throw "Failure when editing transaction";
  }


  oldTransaction.attributes.ticker = transaction.attributes.ticker;
  oldTransaction.attributes.type = transaction.attributes.type;
  oldTransaction.attributes.dateTransacted = transaction.attributes.dateTransacted;
  oldTransaction.attributes.numShares = transaction.attributes.numShares;
  oldTransaction.attributes.value = transaction.attributes.value;
  oldTransaction.attributes.deductFromCash = transaction.attributes.deductFromCash;

  // Run add transaction
  try{
    await addTransaction(oldTransaction, userId);
  } catch (err) {
    let doubleCancelTrans= new Transaction({
      ticker: oldCopy.ticker,
      type: oldCopy.type,
      dateTransacted: formatDate(oldCopy.dateTransacted),
      numShares: oldCopy.numShares,
      value: oldCopy.value,
      deductFromCash: oldCopy.deductFromCash
    });

    try {
      await updatePortfolioValue(doubleCancelTrans, userId);
      await updateDividends(doubleCancelTrans, userId);
    } catch(err) {
      throw "Failure when resetting portfolio";
    }

    throw err;
  }

}

/**
 * Delete existing transaction and update portfolio values
 *
 * @param transId
 * @param userId
 * @returns {Promise.<void>}
 */
async function deleteTransaction(transId, userId) {
  let transaction = await new Transaction({id: transId}).fetch();

  if(!transaction) {
    throw 'Could not find transaction to delete';
  }

  let newType;

  switch(transaction.attributes.type) {
    case 'Buy':
      newType = 'Sell';
      break;
    case 'Sell':
      newType = 'Buy';
      break;
    case 'Short':
      newType = 'Cover';
      break;
    case 'Cover':
      newType = 'Short';
      break;
  }


  let cancelTrans= new Transaction({
    ticker: transaction.attributes.ticker,
    type: newType,
    dateTransacted: formatDate(transaction.attributes.dateTransacted),
    numShares: transaction.attributes.numShares,
    value: transaction.attributes.value,
    deductFromCash: transaction.attributes.deductFromCash
  });

  await updatePortfolioValue(cancelTrans, userId);

  await transaction.destroy();
}


/**
 * Update portfolio with given transaction for user
 *
 * @param transId
 * @param userId
 * @returns {Promise.<void>}
 */
async function updatePortfolioValue(transaction, userId) {

  let fresh = await keepFresh(userId);

  if(!fresh) {
    throw 'Failed to update portfolio';
  }

  let freshDiv = await keepDivsFresh(userId);

  if(!freshDiv) {
    throw 'Failed to update portfolio with dividends';
  }

  // Wait for promises to be filled
  let portfolio =  await new Portfolio({userId: userId}).fetch();

  try {
    await isValidTransaction(portfolio.attributes.id, transaction);
  } catch (err) {
    throw err;
  }




  if(transaction.attributes.ticker === '$') {

    let data = await iexChartGet('GE', '1y');
    let date = parseDateString(transaction.attributes.dateTransacted);
    let value = parseFloat(transaction.attributes.value);

    // No portfolio yet
    if(portfolio.attributes.value === null) {

      if(transaction.attributes.type === 'Withdraw Cash') {
        throw 'Not Enough Funds';
      }


      let dataInd = getClosestDay(date, data);

      let values = [];
      while(dataInd < data.length) {
        let day = {};

        day.date = data[dataInd].date;
        day.stocks = [];
        day.cash = value;
        day.value = 0;

        values.push(day);
        dataInd++;
      }

      await addToCurrentSecurities(portfolio.attributes.id, transaction);

      // Update model
      portfolio.attributes.value = {values};

      // Save to database
      await portfolio.save();

      return;

    } else {
      // Get values array from user portfolio
      let values = portfolio.attributes.value.values;

      // Get index of date closest to the date of the transaction
      let i = getClosestDay(date, data);
      let j = getClosestDay(date, values);
      let valueStack = [];

      // Add values to dates before beginning of portfolio
      while(isAfter(values[j].date, data[i].date)) {
        let day = {}; // Initialize empty object

        // Add day to values string
        day.date = data[i].date;
        day.stocks = [];
        day.cash = value;
        day.value = 0;

        valueStack.push(day);
      }

      // Un-pop stack onto beginning of values array
      while(valueStack.length > 0) {
        values.unshift(valueStack.pop());
      }

      // Get index of date of value added
      j = getIndexOfDate(data[i].date, values);

      // Update Values Already in Portfolio
      while(i < data.length) {
        switch (transaction.attributes.type) {
          case 'Deposit Cash':
            values[j].cash += value;
            break;
          case 'Withdraw Cash':
            if((values[j].cash - value) < 0) {
              throw 'Insufficient Funds'
            } else {
              values[j].cash -= value
            }
            break;
        }
        i++;
        j++;
      }



      await addToCurrentSecurities(portfolio.attributes.id, transaction);

      // Commit to DB
      portfolio.attributes.value = {values};
      await portfolio.save();

      return;
      }
    }




  // Get date from transaction
  let date = parseDateString(transaction.attributes.dateTransacted);

  // Get the stock data for the last year
  let data = await iexChartGet(transaction.attributes.ticker, '1y');

  // Get some commonly used attributes
  let numShares = parseFloat(transaction.attributes.numShares);
  let ticker = transaction.attributes.ticker;


  // TODO - Handle Splits
  multiplier = 1;
  shareMultiplier = 1;
  await buildSplits(ticker, transaction.attributes.dateTransacted, data[data.length-1].date);



  // No portfolio yet
  if(portfolio.attributes.value === null) {

    // Check if the requested transaction is valid for a user with no current values
    if((transaction.attributes.type === 'Sell') || (transaction.attributes.type === 'Cover')) {
      throw 'Cannot ' + transaction.attributes.type + ' without a valid position';
    }

    // Initialize empty values array
    let values = [];


    let i = getClosestDay(formatDate(date), data);

    // Create entries for every day up to the last day of trading
    while(i < data.length) {
      let day = {};

      // Add day to values string
      day.date = data[i].date;

      // Swap multiplier
      if(splits.hasOwnProperty(day.date)) {
        multiplier *= splits[day.date].ratio;
        shareMultiplier /= splits[day.date].ratio;
      }

      // Chose between buy or sell
      switch(transaction.attributes.type) {
        case 'Buy':
          day.stocks = [{ticker: transaction.attributes.ticker, shares: numShares * shareMultiplier}];

          if(transaction.attributes.deductFromCash) {
            day.cash = -(transaction.attributes.value * numShares);
          } else {
            day.cash = 0;
          }

          day.value = data[i].close * multiplier * numShares * shareMultiplier;


          break;
        case 'Short':
          day.stocks = [{ticker: ('$' + transaction.attributes.ticker), shares: -(numShares * shareMultiplier)}];

          if(transaction.attributes.deductFromCash) {
            day.cash = transaction.attributes.value * numShares;
          } else {
            day.cash = 0;
          }

          day.value = (-numShares * shareMultiplier * data[i].close * multiplier);
          break;
      }

      // Add day to values
      values.push(day);
      i++;
    }

    await addToCurrentSecurities(portfolio.attributes.id, transaction);

    // Update model
    portfolio.attributes.value = {values};

    // Save to database
    await portfolio.save();

  } else {

    // Get values array from user portfolio
    let values = portfolio.attributes.value.values;

    // Get index of date closest to the date of the transaction
    let i = getClosestDay(date, data);
    let j = getClosestDay(date, values);
    let valueStack = [];

    // Add values to dates before beginning of portfolio
    while(isAfter(values[j].date, data[i].date)) {
      if((transaction.attributes.type === 'Sell') || (transaction.attributes.type === 'Cover')) {
        console.log('Bad Transaction Type');
        throw 'Cannot ' + transaction.attributes.type + ' without a valid position';
      }

      let day = {}; // Initialize empty object

      // Add day to values string
      day.date = data[i].date;

      // Swap multiplier
      if(splits.hasOwnProperty(day.date)) {
        multiplier *= splits[day.date].ratio;
        shareMultiplier /= splits[day.date].ratio;
      }

      // Choose between buy or short
      switch(transaction.attributes.type) {
        case 'Buy':
          day.stocks = [{ticker: transaction.attributes.ticker, shares: numShares * shareMultiplier}];

          if(transaction.attributes.deductFromCash) {
            day.cash = (-transaction.attributes.value * numShares);
          } else {
            day.cash = 0;
          }

          day.value = data[i].close * multiplier * numShares * shareMultiplier;
          break;
        case 'Short':
          day.stocks = [{ticker: ('$' + transaction.attributes.ticker), shares: -(numShares*shareMultiplier)}];
          day.cash = transaction.attributes.value * multiplier * numShares * shareMultiplier;
          day.value = (-1 * numShares * shareMultiplier * data[i].close * multiplier);
          break;
      }

      valueStack.push(day); // Add day to portfolio values
      i++; // Get next day of data
    }

    // Un-pop stack onto beginning of values array
    while(valueStack.length > 0) {
      values.unshift(valueStack.pop());
    }

    // Get index of date of value added
    j = getIndexOfDate(data[i].date, values);

    let found; // Declare found

    // Update Values Already in Portfolio
    while(i < data.length) {

      // Swap multiplier
      if(splits.hasOwnProperty(data[i].date)) {
        multiplier *= splits[data[i].date].ratio;
        shareMultiplier /= splits[data[i].date].ratio;
      }

      switch(transaction.attributes.type) {
        case 'Buy':
          found = false;
          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ticker) {

              values[j].stocks[k].shares += (numShares * shareMultiplier);

              found = true;
              break;
            }
          }

          if(!found) {
            values[j].stocks.push({ticker: transaction.attributes.ticker, shares: numShares * shareMultiplier});
          }

          if(transaction.attributes.deductFromCash) {
            values[j].cash -= (transaction.attributes.value * numShares);
          }

          values[j].value += (data[i].close * multiplier * numShares * shareMultiplier);

          break;
        case 'Sell':
          found = false;

          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ticker) {

              values[j].stocks[k].shares -= (numShares * shareMultiplier);

              if(transaction.attributes.deductFromCash) {
                values[j].cash += (transaction.attributes.value * numShares);
              }

              values[j].value -= (data[i].close * multiplier * numShares * shareMultiplier);

              // Remove record if sold remaining shares
              if(values[j].stocks[k].shares === 0) {
                values[j].stocks.splice(k, 1);
              }

              found = true;
              break;
            }
          }

          if(!found) {
            console.log('Couldn\'t find stock to sell');
            throw 'Cannot ' + transaction.attributes.type + ' without a valid position';
          }



          break;
        case 'Short':
          found = false;
          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ('$' + ticker)) {

              values[j].stocks[k].shares -= (numShares * shareMultiplier);

              if(transaction.attributes.deductFromCash) {
                day.cash = values[j].cash += transaction.attributes.value * numShares;
              }

              found = true;
              break;
            }
          }
          if(!found) {
            values[j].stocks.push({ticker: ('$' + transaction.attributes.ticker), shares: -(numShares * shareMultiplier)});

            if(transaction.attributes.deductFromCash) {
              values[j].cash += (transaction.attributes.value * numShares);
            }
          }

          values[j].value -= (data[i].close * multiplier * numShares * shareMultiplier);

          break;

        case 'Cover':
          found = false;

          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ('$' + ticker)) {

              values[j].stocks[k].shares += (numShares * shareMultiplier);
              values[j].value += (data[i].close * multiplier * numShares * shareMultiplier);

              // Remove record if sold remaining shares
              if(values[j].stocks[k].shares === 0) {
                values[j].stocks.splice(k, 1);
              }

              if(transaction.attributes.deductFromCash) {
                values[j].cash -= transaction.attributes.value * numShares;
              }

              found = true;
              break;
            }
          }

          if(!found) {
            console.log('Couldn\'t find stock to cover');
            throw 'Cannot ' + transaction.attributes.type + ' without a valid position';
          }
          break;
      }
      i++;
      j++;
    }

    await addToCurrentSecurities(portfolio.attributes.id, transaction);

    // Commit to DB
    portfolio.attributes.unfilledSplits = {unfilledSplits};
    portfolio.attributes.value = {values};
    await portfolio.save();


  }

}


/**
 * Get iex data for ticker on timeframe
 *
 * @param ticker
 * @param timeframe
 * @returns {Promise.<*>}
 */
async function iexChartGet(ticker, timeframe) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/chart/${timeframe}?filter=date,close`,
    json: true,
  });
}

/**
 * Formats a date into the format used by AlphaVantage API
 * @param date
 * @returns {string}
 */
function formatDate(date) {
  let dd = date.getDate();
  let mm = date.getMonth() + 1; //January is 0!
  let yyyy = date.getFullYear();

  if (dd < 10) {
    dd = '0' + dd;
  }
  if (mm < 10) {
    mm = '0' + mm;
  }
  return (yyyy + '-' + mm + '-' + dd);
}


/**
 * Get index of date in the array
 *
 * @param date
 * @param array
 * @returns {*}
 */
const getIndexOfDate = function(date, array) {

  for(i in array) {
    if(array[i].date === date) {
      return i;
    }
  }
  return -1;
};

/**
 * Get index of data equal to or after the specified date
 *
 * @param date
 * @param array
 * @returns {*}
 */
function getClosestDay(date, array) {

  let origDate;

  if((typeof date) === "string") {
    origDate = parseDateString(date);
  } else {
    origDate = date;
  }

  for(i in array) {
    let tempDate = parseDateString(array[i].date);

    if(tempDate >= origDate) {
      return i;
    }
  }

  return -1
}


/**
 * Boolean check of whether or not the first date is after the second
 *
 * @param date1
 * @param date2
 * @returns {boolean}
 */
function isAfter(date1, date2) {
  let dateFirst = parseDateString(date1);
  let dateScnd = parseDateString(date2);

  return dateFirst > dateScnd;
}

/**
 * Boolean check of whether or not the first date is after or equal to the second
 *
 * @param date1
 * @param date2
 * @returns {boolean}
 */
function isAfterOrEqual(date1, date2) {
  let dateFirst = parseDateString(date1);
  let dateScnd = parseDateString(date2);

  return dateFirst >= dateScnd;
}

/**
 * Function to parse date strings of the format "YYYY-MM-DD" correctly every time
 *
 * @param date
 * @returns {Date}
 */
function parseDateString(date) {
  if(date instanceof Date) {
    return date;
  }

  let parts = date.split('-');

  return new Date(parts[0], parts[1] - 1, parts[2]);
}


/**
 * Updates data to latest available data
 *
 * @param userId
 * @returns {Promise.<boolean>}
 */
async function keepFresh(userId) {
  // Wait for promises to be filled
  let portfolio = await new Portfolio({userId: userId}).fetch();

  // Check that the user has a portfolio
  if(!portfolio) {
    return false;
  }

  // Check if the user has added values to the portfolio
  if(!portfolio.attributes.value) {
    return true;
  }

  let values = portfolio.attributes.value.values;

  let oldLength = values.length;

  // Check to see if there are any open positions on the last day recorded
  if(!values[values.length-1].stocks.length) {
    let cash = values[values.length-1].cash; // Cash will not change with updating to latest

    let data = await iexChartGet('GE', '1y'); // Get data to find when latest info is

    // Check that we don't have out of date data in db, currently only support 1 year of data.
    let oldestDay = data[0].date;
    let oldestIndex = getIndexOfDate(oldestDay);

    // If there are dates we don't support, cut them
    if(oldestIndex > 0) {
      values.splice(0, oldestIndex);
    }

    let day = {};

    // Get index of day after last day we have data for
    let dataIndx = getIndexOfDate(values[values.length-1].date, data);
    dataIndx++;



    // For each day up to latest, add empty data
    while(dataIndx < data.length) {
      day.date = data[dataIndx].date;
      day.stocks = [];
      day.value = 0;
      day.cash = cash;

      values.push(day);
    }

    recIndx = values.length - (oldLength - values.length) - 1;

    return true;
  }


  let stocks = [];

  // For each position owned on the last day of data
  for(i in values[values.length-1].stocks) {

    // Check if it is a short or not and format it for iex
    if(values[values.length-1].stocks[i].ticker.charAt(0) === '$') {
      stocks.push(values[values.length-1].stocks[i].ticker.substr(1));
    } else {
      stocks.push(values[values.length-1].stocks[i].ticker);
    }

  }

  let stockData = {};
  let dataPromises = [];

  // Create promises for each of the iex API calls
  for(i in stocks) {
    dataPromises.push(iexChartGet(stocks[i], '1y'));
  }

  let response;

  // Wait for promises to resolve
  try {
    response = await Promise.all(dataPromises);
  } catch (err) {
    console.log('Failed to get stock data');
    return false;
  }

  // Add response data to object for O(1) lookup
  for(i in response) {
    stockData[values[values.length-1].stocks[i].ticker] = response[i];
  }

  // Cash will be the same as the last day no matter what (until dividends are implemented)
  let cash = values[values.length-1].cash;
  let oldStocks = values[values.length-1].stocks;

  // Get the index of the day after the last day known
  let dataIndx = getIndexOfDate(values[values.length-1].date, stockData[values[values.length-1].stocks[0].ticker]); // IPO????
  dataIndx++;

  // Get a ticker to do indexing on
  let testTick = values[values.length-1].stocks[0].ticker;

  // While there is newer data
  while(dataIndx < stockData[testTick].length) {
    let day = {};

    // Initialize data
    day.date = stockData[testTick][dataIndx].date;
    day.stocks = oldStocks;
    day.cash = cash;
    day.value = 0;

    // For each stock, update the daily value
    for(i in day.stocks) {
      day.value += stockData[day.stocks[i].ticker][dataIndx].close * day.stocks[i].shares;
    }

    // Add that data to the values array
    values.push(day);
    dataIndx++;
  }

  recIndx = values.length - (oldLength - values.length) - 1;




  // Commit to DB
  portfolio.attributes.value = {values};
  await portfolio.save();

  return true;
}


/**
 * Returns the values of a portfolio over a specified time frame
 *
 * @param timeframe
 * @param userId
 * @returns {Promise.<Array>}
 */
async function portfolioChartGet(timeframe, userId) {
  let today = new Date();
  let startDate = new Date();


  try {
    await keepFresh(userId);
  } catch (err) {
    console.log(err);
  }

  try {
    await keepDivsFresh(userId);
  } catch (err) {
    console.log(err);
  }


  let portfolio = await new Portfolio({userId: userId}).fetch();

  if(!portfolio) {
    return null;
  }

  if(!portfolio.attributes.value) {
    return null;
  }

  let values = portfolio.attributes.value.values;

  let chart = [];

  switch(timeframe) {
    case '1m':
      startDate.setMonth(today.getMonth() - 1);
      break;
    case '3m':
      startDate.setMonth(today.getMonth() - 3);
      break;
    case '1y':
      startDate.setYear((today.getYear() - 1));
      break;
    default:
      throw timeframe + ' is not a valid time frame for the graph';
  }

  let i = getClosestDay(startDate, values);

  while(i < values.length) {
    chart.push({x: values[i].date, y: (values[i].cash + values[i].value)});
    i++;
  }

  for(i in values[values.length - 1].stocks) {

  }

  return chart;
}


/**
 * Add transaction to current securities by portfolioId
 *
 * @param portfolioId
 * @param transaction
 * @returns {Promise.<*>}
 */
async function addToCurrentSecurities(portfolioId, transaction) {

  let ticker;

  transaction.attributes.value = parseFloat(transaction.attributes.value);
  transaction.attributes.numShares = parseFloat(transaction.attributes.numShares);

  // Check if cash
  if(transaction.attributes.ticker === '$') {
    let currentSecurity = await new CurrentSecurity({portfolioId: portfolioId, ticker: '$'}).fetch();

    if(!currentSecurity) {

      if(transaction.attributes.type === 'Withdraw Cash') {
        throw 'Insufficient Funds';
      }

      let cash = new CurrentSecurity({
        portfolioId: portfolioId,
        ticker: '$',
        numShares: 1,
        costBasis: transaction.attributes.value
        });

      return cash.save()
    } else {

      currentSecurity.attributes.costBasis = parseFloat(currentSecurity.attributes.costBasis);
      currentSecurity.attributes.numShares = parseFloat(currentSecurity.attributes.numShares);

      if (transaction.attributes.type === 'Withdraw Cash') {
        if (currentSecurity.attributes.costBasis - transaction.attributes.value < 0) {
          throw 'Insufficient Funds';
        } else {
          currentSecurity.attributes.costBasis -= transaction.attributes.value;

          if(currentSecurity.attributes.costBasis === 0) {
            return currentSecurity.destroy();
          }
        }
      } else {
        currentSecurity.attributes.costBasis += transaction.attributes.value;
      }

      return currentSecurity.save();
    }
  }

  // Check if Short or Cover
  if((transaction.attributes.type === 'Short') || (transaction.attributes.type === 'Cover')) {
    ticker = '$' + transaction.attributes.ticker;
  } else {
    ticker = transaction.attributes.ticker;
  }

  let currentSecurity = await new CurrentSecurity({portfolioId: portfolioId, ticker: ticker}).fetch();

  if(!currentSecurity) {
    if((transaction.attributes.type === 'Sell') || (transaction.attributes.type === 'Cover')) {
      throw 'No valid current position';
    }

    let newPosition = new CurrentSecurity({
      portfolioId: portfolioId,
      ticker: ticker,
      numShares: transaction.attributes.numShares * shareMultiplier,
      costBasis: transaction.attributes.value / shareMultiplier
    });

    if(transaction.attributes.deductFromCash) {
      await updateCurrentCash(portfolioId, transaction.attributes.type, (transaction.attributes.numShares * transaction.attributes.value));
    }


    return newPosition.save();
  } else {

    currentSecurity.attributes.costBasis = parseFloat(currentSecurity.attributes.costBasis);
    currentSecurity.attributes.numShares = parseFloat(currentSecurity.attributes.numShares);

    if((transaction.attributes.type === 'Sell')
      || (transaction.attributes.type === 'Cover')) {

      let sharesNow = currentSecurity.attributes.numShares - (transaction.attributes.numShares * shareMultiplier);

      if(sharesNow === 0) {
        await currentSecurity.destroy();

        if(transaction.attributes.deductFromCash) {
          await updateCurrentCash(portfolioId, transaction.attributes.type, (transaction.attributes.numShares * transaction.attributes.value));
        }

        return;
      } else {
        currentSecurity.attributes.costBasis = ((currentSecurity.attributes.costBasis * currentSecurity.attributes.numShares) - (transaction.attributes.numShares * shareMultiplier * transaction.attributes.value)) / (sharesNow);
        currentSecurity.attributes.numShares = sharesNow;
      }
    } else {
      let sharesNow = currentSecurity.attributes.numShares + transaction.attributes.numShares * shareMultiplier;
      currentSecurity.attributes.costBasis = ((currentSecurity.attributes.costBasis * currentSecurity.attributes.numShares) + (transaction.attributes.numShares  * shareMultiplier * transaction.attributes.value)) / (sharesNow);
      currentSecurity.attributes.numShares = sharesNow;
    }

    if(transaction.attributes.deductFromCash) {
      await updateCurrentCash(portfolioId, transaction.attributes.type, (transaction.attributes.numShares * transaction.attributes.value));
    }

    await currentSecurity.save();
  }
}


async function getCurrentSecurities(portfolioId) {
  let currentSecurities = await CurrentSecurity
    .where({portfolioId: portfolioId})
    .fetchAll();

  let securities = [];

  if(!currentSecurities) {
    return securities;
  }

  currentSecurities = currentSecurities.toJSON();

  for(i in currentSecurities) {
    if(currentSecurities[i].ticker === '$') {
      let security = {
        ticker: '$',
        last: currentSecurities[i].costBasis,
        change: null,
        shares: null,
        cost: null,
        value : currentSecurities[i].costBasis,
        gain : null,
        pctGain : null,
        dayGain : null
      };

      currentSecurities.splice(i, 1);

      securities.push(security)
    }
  }

  let stocks = [];

  for(i in currentSecurities) {

    if (currentSecurities[i].ticker.charAt(0) === '$') {
      stocks.push(currentSecurities[i].ticker.substr(1));
    } else {
      stocks.push(currentSecurities[i].ticker);
    }
  }

  let stockData = {};
  let dataPromises = [];

  // Create promises for each of the iex API calls
  for(i in stocks) {
    dataPromises.push(iexCloseGet(stocks[i]));
  }

  let response;

  // Wait for promises to resolve
  try {
    response = await Promise.all(dataPromises);
  } catch (err) {
    console.log('Failed to get stock data');
    return false;
  }

  // Add response data to object for O(1) lookup
  for(i in response) {
    stockData[currentSecurities[i].ticker] = {close: response[i].close.price, open: response[i].open.price};
  }

  for(i in currentSecurities) {
    let security = {};

    // Handle Shorts
    if(currentSecurities[i].ticker.charAt(0) === '$') {
      security.ticker = currentSecurities[i].ticker.substr(1) + ' Short';
      security.last = -stockData[currentSecurities[i].ticker].close;
      security.change = Math.round( (-stockData[currentSecurities[i].ticker].close + stockData[currentSecurities[i].ticker].open) * 100) / 100;
      security.shares = currentSecurities[i].numShares;
      security.cost = Math.round((currentSecurities[i].costBasis * security.shares) * 100) / 100;
      security.value = Math.round(( security.shares * security.last) * 100) / 100;
      security.gain = Math.round((security.cost - security.value) * 100)/100;
      security.pctGain = Math.round((security.gain / security.cost) * 10000) / 100;
      security.dayGain = Math.round(security.change * security.shares * 100) / 100;
    } else {
      security.ticker = currentSecurities[i].ticker;
      security.last = stockData[currentSecurities[i].ticker].close;
      security.change = Math.round( (stockData[currentSecurities[i].ticker].close - stockData[currentSecurities[i].ticker].open) * 100) / 100;
      security.shares = currentSecurities[i].numShares;
      security.cost = Math.round((currentSecurities[i].costBasis * security.shares) * 100) / 100;
      security.value = Math.round( (security.shares * security.last) * 100 ) / 100;
      security.gain = Math.round((security.value - security.cost) * 100)/100;
      security.pctGain = Math.round((security.value / security.cost - 1) * 10000) / 100;
      security.dayGain = Math.round(security.change * security.shares * 100) / 100;
    }

    securities.push(security);
  }
  return securities;
}


async function iexCloseGet(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/ohlc?`,
    json: true,
  });
}


/**
 * Will throw an error if the transaction is not valid
 *
 * @param portfolioId
 * @param transaction
 * @returns {Promise.<void>}
 */
async function isValidTransaction(portfolioId, transaction) {

  transaction = transaction.toJSON();

  let requestedSecurity = await CurrentSecurity
    .where({portfolioId: portfolioId, ticker: transaction.ticker})
    .fetch();

  let cashSecurity = await CurrentSecurity
    .where({portfolioId: portfolioId, ticker: '$'})
    .fetch();


  let cash;
  if(cashSecurity) {
    cash = cashSecurity.attributes.costBasis;
  } else {
    cash = 0;
  }

  switch (transaction.type) {
    case 'Buy':
      if (transaction.deductFromCash) {
        if ((cash - transaction.value * transaction.numShares) < 0) {
          throw 'Insufficient Funds';
        }
      }
      break;
    case 'Sell':

      if (!requestedSecurity) {
        throw 'Must own a security to be able to sell it';
      } else {
        requestedSecurity = requestedSecurity.toJSON();

        if(transaction.numShares > requestedSecurity.numShares) {
          throw 'Not Enough Shares Owned to Sell';
        }
      }

      break;
    case 'Cover':

      if (transaction.deductFromCash) {
        if ((cash - transaction.value * transaction.numShares) < 0) {
          throw 'Insufficient Funds';
        }
      }

      let short = await new CurrentSecurity({ticker: '$' + transaction.ticker}).fetch();

      if(!short) {
        throw 'Must own a short to be able to cover it';
      } else {
        short = short.toJSON();

        if(transaction.numShares > short.numShares) {
          throw 'Must own enough shorts to sell that many';
        }
      }


      break;
    case 'Withdraw Cash':
      if (transaction.deductFromCash) {
        if ((cash - transaction.value) < 0) {
          throw 'Insufficient Funds';
        }
      }
      break;
  }
}

/*
 * GET /portfolio/:portfolioId/transaction/export
 */

exports.exportTransaction = async (req, res) => {
  // Begin access check block
  let hasAccess = false;
  try {
    hasAccess = await hasPortfolioAccess(req.user.attributes.id, req.params.portfolioId);
  } catch (err) {
    console.error(err);
    return res.render('error', { msg: `An error occured while evaluating your right to see this page.`, title: 'Error' });
  }
  if (!hasAccess) {
    return res.render('error', { msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error' });
  }
  // End access check block
  let content = 'ticker,value,numShares,type,dateTransacted,created_at,updated_at,deductFromCash';
  try {
    let transactions = await new Transaction().where('portfolioId', req.params.portfolioId).orderBy('dateTransacted', 'DESC').fetchAll();
    transactions = transactions.models.map(x => x.attributes);
    transactions.forEach((t) => {
      content += '\n' + t.ticker + ',' + t.value + ',' + t.numShares + ',' + t.type + ',' + t.dateTransacted + ',' + t.created_at + ',' + t.updated_at + ',' + t.deductFromCash;
    });
  } catch (err) {
    const msg = `Error when grabbing transactions for portfolio.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, { msg, title: 'Error' });
  }
  const datetime = new Date();
  res.set({ 'Content-Disposition': 'attachment; filename="' + datetime + '.csv"' });
  res.send(content);
}

/*
 * POST /portfolio/:portfolioId/transaction/import
 */

exports.importTransaction = async (req, res) => {
  // Begin access check block
  let hasAccess = false;
  try {
    hasAccess = await hasPortfolioAccess(req.user.attributes.id, req.params.portfolioId);
  } catch (err) {
    console.error(err);
    return res.render('error', {
      msg: `An error occured while evaluating your right to see this page.`,
      title: 'Error'
    });
  }
  if (!hasAccess) {
    return res.render('error', {msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error'});
  }
  // End access check block
  let file = req.files.file;
  let filePath = path.join(os.tmpdir(), file.md5);
  file.mv(filePath);
  fs.readFile(filePath, async (err, data) => {
    if (err) {
      console.error(err);
      req.flash('error', {msg: 'Errors occurred. Nothing was changed.'});
      return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
    }
    // convert buffer to string
    data = data.toString('utf8');
    // parse CSV file
    parse(data, {from: 2}, async (err, output) => {
      if (err) {
        console.error(err);
        req.flash('error', {msg: 'Errors occurred. Nothing was changed.'});
        return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
      } else {
        // remove existing transactions from database
        try {
          new Transaction().where('portfolioId', req.params.portfolioId).destroy();
        } catch (err) {
          const msg = `An error occured while deleting the transaction.`;
          console.error(msg);
          console.error(err);
          return res.render(`error`, {msg, title: `Error`});
        }
        // store new transactions in database
        output.forEach(async t => {
          try {
            let date = new Date(t[4]);
            let dateString = '' + date.getUTCFullYear() + '-' + ("0" + (date.getUTCMonth() + 1)).slice(-2) + '-' + ("0" + date.getUTCDate()).slice(-2);
            let transaction = new Transaction({
              userId: req.user.attributes.id,
              portfolioId: req.params.portfolioId,
              ticker: t[0],
              value: t[1],
              numShares: t[2],
              type: t[3],
              dateTransacted: dateString,
              deductFromCash: (t[7] === 'TRUE')
            });
            // save transaction in database
            await addTransaction(transaction, req.user.attributes.id);
          } catch (err) {
            const msg = `An error occured while adding or editing a transaction.`;
            console.error(msg);
            console.error(err);
            return res.render(`error`, {msg, title: `Error`});
          }
        });
        req.flash('success', {msg: 'Your transactions have been imported.'});
        return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
      }
    });
    // delete file
    fs.unlink(filePath, function (err) {
      if (err) console.error(err);
    });
  });
};

async function updateCurrentCash(portfolioId, type, value) {
  let currentCash = await new CurrentSecurity({portfolioId: portfolioId, ticker: '$'}).fetch();

  value = parseFloat(value);

  switch(type) {
    case 'Buy':
      value = value * -1;
      break;
    case 'Cover':
      value = value * -1;
      break;
  }

  let temp;

  if(!currentCash) {
    temp = new CurrentSecurity({
      portfolioId: portfolioId,
      ticker: '$',
      numShares: 1,
      costBasis: value
    });
  } else {
    currentCash.attributes.costBasis = parseFloat(currentCash.attributes.costBasis);
    currentCash.attributes.costBasis += value;

    temp = currentCash;
  }

  await temp.save();
}



async function getDividendsData(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/dividends/1y`,
    json: true,
  });
}


async function updateDividends(trans, userId) {
  // if (type is buy)
  //    check for valid dividend days after purchase and award cash
  // if (type is sell)
  //    check for valid dividend days after sale and remove cash
  // else
  //    do nothing

  // Get user's portfolio
  let portfolio = await new Portfolio({userId: userId}).fetch();

  // Check that the user has a portfolio
  if(!portfolio) {
    return false;
  }

  // Check if the user has added values to the portfolio
  if(!portfolio.attributes.value) {
    return true;
  }

  //let lastExDate = portfolio.attributes.lastExDate;

  let values = portfolio.attributes.value.values;

  let temp = portfolio.attributes.unfilledDivs;

  if(!temp) {
    unfilledDivs = {};
  } else {
    unfilledDivs = temp.unfilledDivs;
  }


  let response = await getDividendsData(trans.attributes.ticker);

  let dividends = formatDividends(response);

  let extraCash = 0;
  let shares = trans.attributes.numShares;

  switch (trans.attributes.type) {
    case "Buy":

      for(let exDate in dividends) {
        if((isAfter(exDate, trans.attributes.dateTransacted)) && (isAfterOrEqual(values[values.length-1].date, dividends[exDate].paymentDate))) {
          extraCash += dividends[exDate].amount * shares;

          values = updateValuesWithDiv(dividends[exDate], values, "Buy", shares);
        } else {
          if((isAfter(exDate, trans.attributes.dateTransacted))) {
            addToUnfilled(trans.attributes.ticker, dividends[exDate].paymentDate, getDayBefore(exDate, values), dividends[exDate].amount);
          }

        }
      }
      break;
    case "Sell":
      for(let exDate in dividends) {
        if((isAfter(exDate, trans.attributes.dateTransacted)) && (isAfterOrEqual(values[values.length-1].date, dividends[exDate].paymentDate))) {
          extraCash -= dividends[exDate].amount * shares;
          values = updateValuesWithDiv(dividends[exDate], values, "Sell", shares);
        }
      }
      break;
    default:
      return;
  }

  await updateCashWithDividend(portfolio.attributes.id, extraCash);

  // Commit to DB
  portfolio.attributes.unfilledDivs = {unfilledDivs};
  portfolio.attributes.value = {values};
  await portfolio.save();

}


async function keepDivsFresh(userId) {
  // Get user's portfolio
  let portfolio = await new Portfolio({userId: userId}).fetch();

  // Check that the user has a portfolio
  if(!portfolio) {
    return false;
  }

  // Check if the user has added values to the portfolio
  if(!portfolio.attributes.value) {
    return true;
  }

  // Get Unfilled Divs
  let temp = portfolio.attributes.unfilledDivs;

  if(!temp) {
    unfilledDivs = {};
  } else {
    unfilledDivs = temp.unfilledDivs;
  }

  // Get Unfilled Splits
  let tempSp = portfolio.attributes.unfilledSplits;

  if(!tempSp) {
    unfilledSplits = {};
  } else {
    unfilledSplits = tempSp.unfilledSplits;
  }

  let values = portfolio.attributes.value.values;

  handleUnfilled(values[values.length-1].date, values);
  handleUnfilledSplits(values[values.length-1].date, values);

  await buildFreshSplits(values[recIndx], values);

  await buildFreshDividends(values[recIndx], values);

  while(recIndx < ((values.length)-1)) {

    await implementSplits(portfolio.attributes.id, recIndx, freshSplits[values[recIndx+1].date], values);

    implementDivs(recIndx, freshDividends[values[recIndx+1].date], values);

    recIndx++;
  }

  await updateCashWithDividend(portfolio.attributes.id, totalFreshValue);

  // Commit to DB
  portfolio.attributes.unfilledDivs = {unfilledDivs};
  portfolio.attributes.unfilledSplits = {unfilledSplits};
  portfolio.attributes.value = {values};
  await portfolio.save();


  return true;
}

function handleUnfilled(finDate, values) {
  for(let payday in unfilledDivs) {
    if(isAfterOrEqual(finDate, payday)) {
      implementUnfilledDivs(payday, unfilledDivs[payday], values);
      delete unfilledDivs[payday];
    }
  }
}


function buildFreshDividendObject(data, ticker, values) {
  for(let i in data) {

    if(getClosestDay(data[i].paymentDate, values) === -1) {

      addToUnfilled(ticker, data[i].paymentDate, getDayBefore(data[i].exDate, values), data[i].amount);

      continue;
    }

    let div = {
      ticker: ticker,
      paymentDate: data[i].paymentDate,
      amount: parseFloat(data[i].amount)
    };

    if(freshDividends.hasOwnProperty(data[i].exDate)) {
      freshDividends[data[i].exDate].push(div);
    } else {
      freshDividends[data[i].exDate] = [];
      freshDividends[data[i].exDate].push(div);
    }
  }
}

function addToUnfilled(ticker, payday, date, amount) {

  if(!unfilledDivs.hasOwnProperty(payday)) {
    unfilledDivs[payday] = [];
  }

  for(let i in unfilledDivs[payday]) {
    if(unfilledDivs[payday][i].ticker === ticker) {
      return;
    }
  }

  unfilledDivs[payday].push({
    ticker: ticker,
    date: date,
    amount: amount
  });
}

function formatDividends(data) {

  let res = {};

  for(i in data) {
    let div = {
      paymentDate: data[i].paymentDate,
      amount: parseFloat(data[i].amount)
    };

    res[data[i].exDate] = div;
  }

  return res;
}

function getDayBefore(dateString, data) {
  let date = parseDateString(dateString);

  for(i=(data.length-1); i >= 0; i--) {
    let tempDate = parseDateString(data[i].date);

    if(tempDate < date) {
      return data[i].date;
    }
  }

  return -1
}

function ownedShares(value, ticker) {
  for(i in value.stocks) {
    if(value.stocks[i].ticker === ticker) {
      return value.stocks[i].shares;
    }
  }

  return 0;
}

async function updateCashWithDividend(portfolioId, value) {
  let currentCash = await new CurrentSecurity({portfolioId: portfolioId, ticker: '$'}).fetch();

  let temp;

  if(!currentCash) {
    temp = new CurrentSecurity({
      portfolioId: portfolioId,
      ticker: '$',
      numShares: 1,
      costBasis: value
    });
  } else {
    currentCash.attributes.costBasis = parseFloat(currentCash.attributes.costBasis);
    currentCash.attributes.costBasis += value;

    temp = currentCash;
  }

  await temp.save();
}

function updateValuesWithDiv(dividend, values, type, shares) {

  let payIndx = getIndexOfDate(dividend.paymentDate, values);



  while(payIndx < values.length) {

    switch(type) {
      case "Buy":
        values[payIndx].cash += (dividend.amount * shares);
        break;
      case "Sell":
        values[payIndx].cash -= (dividend.amount * shares);

        if(values[payIndx].cash < 0) {
          throw "Cannot sell stock as dividend cash was spent";
        }
        break;
    }

    payIndx++;

  }

  return values;
}



async function buildFreshDividends(value, values) {

  let dataPromises = [];
  let indexedTickers = [];
  let response = [];


  for(let i in value.stocks) {
    // Check if already have dividend data and download if not
    dataPromises.push(getDividendsData(value.stocks[i].ticker));
    indexedTickers.push(value.stocks[i].ticker);
  }

  // Wait for promises to resolve
  try {
    response = await Promise.all(dataPromises);
  } catch (err) {
    console.log('Failed to get dividend data');
    return false;
  }

  for(let i in response) {
    buildFreshDividendObject(response[i], indexedTickers[i], values);
  }
}


function implementDivs(dayIndx, dividends, values) {

  //console.log(dividends);
  for(let i in dividends) {

    let dateIndx = getClosestDay(dividends[i].paymentDate, values);

    let divValue = ownedShares(values[dayIndx], dividends[i].ticker) * dividends[i].amount;

    values = addDiv(dateIndx, divValue, values);
  }
}


function implementUnfilledDivs(payday, dividends, values) {

  //console.log(dividends);
  for(let i in dividends) {

    let dateIndx = getClosestDay(payday, values);

    let divValue = ownedShares(dividends[i].date, dividends[i].ticker) * dividends[i].amount;

    values = addDiv(dateIndx, divValue, values);
  }
}


function addDiv(dateIndx, divValue, values) {
  while(dateIndx < values.length) {
    values[dateIndx].cash += divValue;

    dateIndx++;
  }

  totalFreshValue += divValue;
}







/* ~~~~~~~~ SPLITS FUNCTIONS ~~~~~~~~ */

async function getSplitsData(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/splits/1y`,
    json: true,
  });
}

async function buildSplits(ticker, transDate, finalDate, values) {
  let response = await getSplitsData(ticker);

  for(let i in response) {
    if(isAfter(response[i].exDate, transDate)) {
      if(isAfterOrEqual(finalDate, response[i].paymentDate)) {
        multiplier /= response[i].ratio;
        addToSplits(response[i]);
      } else {
        let date = values[getDayBefore(response[i].exDate, values)].date;
        addToUnfilledSplits(ticker, response[i], date);
      }
    }
  }
}

function addToSplits(split) {
  if(!splits.hasOwnProperty(split.paymentDate)) {
    splits[split.paymentDate] = {
      exDate: split.exDate,
      ratio: split.ratio
    };
  }
}

function addToUnfilledSplits(ticker, split, date) {

  if(!unfilledSplits.hasOwnProperty(split.paymentDate)) {
    unfilledSplits[split.paymentDate] = [];
  }

  for(let i in unfilledSplits[split.paymentDate]) {
    if(unfilledSplits[split.paymentDate][i].ticker === ticker) {
      return;
    }
  }

  unfilledSplits[split.paymentDate].push({
    ticker: ticker,
    date: date,
    ratio: split.ratio
  });
}

function handleUnfilledSplits(finDate, values) {
  for(let splitday in unfilledSplits) {
    if(isAfterOrEqual(finDate, splitday)) {
      implementUnfilledSplits(splitday, unfilledSplits[splitday], values);
      delete unfilledSplits[splitday];
    }
  }
}

function implementUnfilledSplits(splitday, splits, values) {

  for(let i in splits) {

    let dateIndx = getClosestDay(splitday, values);

    let origShares = ownedShares(splits[i].date, splits[i].ticker);

    let splitShares = origShares / splits[i].ratio;

    addSplit(dateIndx, origShares, splitShares, values, splits[i].ticker);
  }
}

function addSplit(dateIndx, origShares, splitShares, values, ticker) {
  while(dateIndx < values.length) {
    for(let i in values[dateIndx].stocks) {
      if(values[dateIndx].stocks[i].ticker === ticker) {
        values[dateIndx].stocks[i].shares -= (origShares - splitShares);
      }
    }

    dateIndx++;
  }

  totalFreshValue += divValue;
}

async function buildFreshSplits(value, values) {

  let dataPromises = [];
  let indexedTickers = [];
  let response = [];


  for(let i in value.stocks) {
    // Check if already have dividend data and download if not
    dataPromises.push(getSplitsData(value.stocks[i].ticker));
    indexedTickers.push(value.stocks[i].ticker);
  }

  // Wait for promises to resolve
  try {
    response = await Promise.all(dataPromises);
  } catch (err) {
    console.log('Failed to get dividend data');
    return false;
  }

  for(let i in response) {
    buildFreshSplitsObject(response[i], indexedTickers[i], values);
  }
}

function buildFreshSplitsObject(data, ticker, values) {
  for(let i in data) {

    if(getClosestDay(data[i].paymentDate, values) === -1) {

      addToUnfilledSplits(ticker, data[i], getDayBefore(data[i].exDate, values));

      continue;
    }

    let split = {
      ticker: ticker,
      paymentDate: data[i].paymentDate,
      ratio: parseFloat(data[i].ratio)
    };

    if(freshSplits.hasOwnProperty(data[i].exDate)) {
      freshSplits[data[i].exDate].push(split);
    } else {
      freshSplits[data[i].exDate] = [];
      freshSplits[data[i].exDate].push(split);
    }
  }
}

async function implementSplits(portfolioId, dayIndx, splits, values) {

  //console.log(dividends);
  for(let i in splits) {

    let dateIndx = getClosestDay(splits[i].paymentDate, values);

    let origShares = ownedShares(values[dayIndx], splits[i].ticker) ;

    let splitShares = origShares  * splits[i].ratio;

    addSplit(dateIndx, origShares, splitShares, values, splits[i].ticker);

    await updateCurrentWithSplit(portfolioId, splits[i].ticker, splits[i].ratio );
  }
}


async function updateCurrentWithSplit(portfolioId, ticker, ratio) {
  let currentSecurity = await new CurrentSecurity({portfolioId: portfolioId, ticker: ticker}).fetch();

  currentSecurity.attributes.numShares /= ratio;
  currentSecurity.attributes.costBasis *= ratio;

  await currentSecurity.save();
}
