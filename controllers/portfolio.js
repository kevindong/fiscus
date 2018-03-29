var User = require('../models/User');
var Portfolio = require('../models/Portfolio');
var Transaction = require('../models/Transaction');
var TickerController = require('../controllers/ticker.js');
const rp = require('request-promise');
const iextradingRoot = 'https://api.iextrading.com/1.0';

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
    return res.render(`error`, {msg, title: 'Error'});
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
      return res.render(`error`, {msg, title: 'Error'});
    }
    req.flash('success', { msg: `We noticed that you didn't have a portfolio yet. No worries, we created one for you!` });
  }

  // Grabbing the 5 most recent transactions.
  let transactions;
  let securityNames;
  try {
    transactions = await new Transaction().where('portfolioId', portfolio.id).orderBy('dateTransacted', 'DESC').fetchPage({pageSize: 5, page: 1});
    transactions = transactions.models.map(x => x.attributes);
    securityNames = await getSecurityNames(transactions.map(x => x.ticker));
  } catch (err) {
    const msg = `Error when grabbing transactions for portfolio.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, {msg, title: 'Error'});
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
  return res.render('portfolio/portfolio.jade', {
    title: 'Portfolio',
    portfolioId: portfolio.attributes.id,
    transactions: transactions,
    securityNames: securityNames,
    portfolioChart: JSON.stringify(portfolioChart)
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
    portfolio = await new Portfolio({userId: userId, id: portfolioId}).fetch();
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
      transactionStatus = await new Transaction({id: transactionId, portfolioId: portfolioId}).fetch();
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
    return res.render('error', {msg: `You don't have rights to see this portfolio.`});
  }
  // End access check block

  console.log(await portfolioChartGet('1m', req.user.attributes.id));

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
    return res.render(`error`, {msg, title: 'Error'});
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
    return res.render('error', {msg: `An error occurred while evaluating your right to see this page.`, title: 'Error'});
  }
  if (!hasAccess) {
    return res.render('error', {msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error'});
  }
  // End access check block

  if (req.params.transactionId) { // editing existing transaction
    let transaction;
    try {
      transaction = await new Transaction({id: req.params.transactionId}).fetch();
      yahooName = await TickerController.yahooNameExchangeGet(transaction.attributes.ticker);
    } catch (err) {
      const msg = `An error occured while getting the transaction to be edited.`;
      console.error(msg);
      console.error(err);
      return res.render(`error`, {msg, title: `Error`});
    }
    return res.render(`portfolio/edit_transaction`, {
      title: `Add Transaction`,
      portfolioId: req.params.portfolioId,
      transaction: transaction.attributes,
      yahooName: `${transaction.attributes.ticker} - ${yahooName.name}`
    });
  } else { // creating new transaction
    return res.render(`portfolio/edit_transaction`, {
      title: `Add Transaction`,
      portfolioId: req.params.portfolioId,
      transaction: undefined
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
    return res.render('error', {msg: `You don't have rights to see this portfolio or transaction.`, title: 'Error'});
  }
  // End access check block

  req.assert('action', `You must select one of the 'Action' choices.`).action_type();
  req.assert('date', 'You must enter a valid date.').isDate();
  // I should validate the ticker here but as it turns out, it's really, really
  // hard to do async validations. So, client-side validation only it is. 
  req.assert('value', `Value must be numeric, have at most 2 decimal places, and be less than $99,999,999.99.`).isDecimal({decimal_digits: 2}).isFloat({min: 0, max: 99999999.99});
  req.assert('shares', `Shares must be numeric, be greater than 0, and have at most 4 decimal places, and be less than 99,999,999.9999.`).isDecimal({decimal_digits: 4}).isFloat({min: 0.0001, max: 99999999.9999});

  let errors = req.validationErrors();
  if (errors) {
    req.flash('error', errors);
    return res.render('portfolio/edit_transaction', {
      portfolioId: req.body.portfolioId,
      title: "Edit Transaction"
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
    return res.render(`error`, {msg, title: `Error`});
  }

  // TODO - Update Portfolio Values
  // try {
  //   await updatePortfolioValue(transaction,req.user.attributes.id);
  // } catch(err) {
  //   console.log(err);
  //   return res.render('error', {msg: `An error occurred while updating your portfolio`, title: 'Error'});
  // }


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
    return res.render('error', {msg: `You don't have rights to delete this transaction.`, title: 'Error'});
  }
  // End access check block

  let transaction;
  try {
    transaction = new Transaction({id: req.params.transactionId}).destroy()
  } catch (err) {
    const msg = `An error occurred while deleting the transaction.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, {msg, title: `Error`});
  }
  req.flash('success', {msg: 'Your transaction has been deleted.'});
  return res.redirect(`/portfolio/${req.params.portfolioId}/transactions`);
};




// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ Begin Portfolio Adjustment Code ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


async function addTransaction(transaction, userId) {
  // Check if updatePortfolio works
  try{
    await updatePortfolioValue(transaction, userId);
  } catch(err) {
    console.log(err);
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
  await deleteTransaction(oldId, userId);

  transaction['id'] = oldId;

  // Run add transaction
  await addTransaction(transaction, userId);
}

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

  // Wait for promises to be filled
  let portfolio =  await new Portfolio({userId: userId}).fetch();

  // Get date from transaction
  let date = parseDateString(transaction.attributes.dateTransacted);

  // Get the stock data for the last year
  let data = await iexChartGet(transaction.attributes.ticker, '1y');

  // Get some commonly used attributes
  let numShares = parseFloat(transaction.attributes.numShares);
  let ticker = transaction.attributes.ticker;

  // No portfolio yet
  if(portfolio.attributes.value === null) {

    // Check if the requested transaction is valid for a user with no current values
    if((transaction.attributes.type === 'Sell') || (transaction.attributes.type === 'Cover')) {
      throw 'Cannot ' + transaction.attributes.type + 'without a valid position';
    }

    // Initialize empty values array
    let values = [];


    let i = getIndexOfDate(formatDate(date), data);

    // Create entries for every day up to the last day of trading
    while(i < data.length) {
      let day = {};

      // Add day to values string
      day.date = data[i].date;

      // Chose between buy or sell
      switch(transaction.attributes.type) {
        case 'Buy':
          day.stocks = [{ticker: transaction.attributes.ticker, shares: numShares}];

          console.log(typeof transaction.attributes.deductFromCash);

          if(transaction.attributes.deductFromCash) {
            console.log('here');
            day.cash = -transaction.attributes.value * numShares;
          } else {
            day.cash = 0;
          }

          day.value = data[i].close * numShares;


          break;
        case 'Short':
          day.stocks = [{ticker: ('$' + transaction.attributes.ticker), shares: -numShares}];

          if(transaction.attributes.deductFromCash) {
            day.cash = transaction.attributes.value * numShares;
          } else {
            day.cash = 0;
          }

          day.value = (-numShares * data[i].close);
          break;
      }

      // Add day to values
      values.push(day);
      i++;
    }

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
        throw 'Cannot ' + transaction.attributes.type + 'without a valid position';
      }

      let day = {}; // Initialize empty object

      // Add day to values string
      day.date = data[i].date;

      // Choose between buy or short
      switch(transaction.attributes.type) {
        case 'Buy':
          day.stocks = [{ticker: transaction.attributes.ticker, shares: numShares}];

          if(transaction.attributes.deductFromCash) {
            day.cash = -transaction.attributes.value * numShares;
          } else {
            day.cash = 0;
          }

          day.value = data[i].close * numShares;
          break;
        case 'Short':
          day.stocks = [{ticker: ('$' + transaction.attributes.ticker), shares: -numShares}];
          day.cash = transaction.attributes.value * numShares;
          day.value = (-1 * numShares * data[i].close);
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
      switch(transaction.attributes.type) {
        case 'Buy':
          found = false;
          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ticker) {

              values[j].stocks[k].shares += numShares;

              found = true;
              break;
            }
          }

          if(!found) {
            values[j].stocks.push({ticker: transaction.attributes.ticker, shares: numShares});
          }

          if(transaction.attributes.deductFromCash) {
            values[j].cash -= transaction.attributes.value * numShares;
          }

          values[j].value += data[i].close * numShares;

          break;
        case 'Sell':
          found = false;

          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ticker) {

              values[j].stocks[k].shares -= numShares;

              if(transaction.attributes.deductFromCash) {
                values[j].cash += transaction.attributes.value * numShares;
              }

              values[j].value -= data[i].close * numShares;

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
            throw 'Cannot ' + transaction.attributes.type + 'without a valid position';
          }



          break;
        case 'Short':
          found = false;
          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ('$' + ticker)) {

              values[j].stocks[k].shares -= numShares;

              if(transaction.attributes.deductFromCash) {
                day.cash = values[j].cash += transaction.attributes.value * numShares;
              }

              found = true;
              break;
            }
          }
          if(!found) {
            values[j].stocks.push({ticker: ('$' + transaction.attributes.ticker), shares: -numShares});

            if(transaction.attributes.deductFromCash) {
              values[j].cash += transaction.attributes.value * numShares;
            }
          }

          values[j].value -= data[i].close * numShares;

          break;

        case 'Cover':
          found = false;

          for(k in values[j].stocks) {
            if(values[j].stocks[k].ticker === ('$' + ticker)) {

              values[j].stocks[k].shares += numShares;
              values[j].value += data[i].close * numShares;

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
            throw 'Cannot ' + transaction.attributes.type + 'without a valid position';
          }
          break;
      }
      i++;
      j++;
    }


    // TODO : Update current day with today's data

    // Commit to DB
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

  for(i in array) {
    let tempDate = parseDateString(array[i].date);

    if(tempDate >= date) {
      return i;
    }
  }

  return -1
}


/**
 * Boolean check of whether of not the first date is after the second
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

  // Check to see if there are any open positions on the last day recorded
  if(!values[values.length-1].stocks.length) {
    let cash = values[values.length-1].cash; // Cash will not change with updating to latest

    let data = await iexChartGet('GE', '1y'); // Get data to find when latest info is

    // Check that we dont have out of date data in db, currently only support 1 year of data.
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

  // Get a ticker to do index testing on
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

  await keepFresh(userId);

  let portfolio = await new Portfolio({userId: userId}).fetch();

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

  return chart;
}