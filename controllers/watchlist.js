var Watchlist = require('../models/Watchlist');
var PortfolioController = require('../controllers/portfolio.js')
const rp = require('request-promise');

/**
 * GET /watchlist
 */
exports.watchlistGet = async function (req, res) {
  let watchedSecurities;
  try {
    watchedSecurities = await new Watchlist().where('userId', req.user.attributes.id).fetchAll();
  } catch (err) {
    const msg = `Couldn't get user's watched securities.`;
    console.error(msg);
    console.error(err);
    return res.render(`error`, {msg, title: 'Error'});
  }
  if (watchedSecurities === null) {
    watchedSecurities = [];
  }
  watchedSecurities = watchedSecurities.map(x => x.attributes);
  if (watchedSecurities.length > 0) {
    let names;
    try {
      names = await PortfolioController.getSecurityNames(watchedSecurities.map(x => x.ticker));
    } catch (err) {
      const msg = `Couldn't get the security names.`;
      console.error(msg);
      console.error(err);
      return res.render(`error`, {msg, title: 'Error'});
    }
    let prices;
    try {
      let tickers = watchedSecurities.map(x => x.ticker).join(',');
      prices = await rp({
        uri: `https://api.iextrading.com/1.0/stock/market/batch?symbols=${tickers}&types=price`,
        json: true
      });
    } catch (err) {
      const msg = `Couldn't get the current prices of the securities.`;
      console.error(msg);
      console.error(err);
      return res.render(`error`, {msg, title: 'Error'});
    }
    for (let i = 0; i < watchedSecurities.length; i++) {
      watchedSecurities[i].name = names[watchedSecurities[i].ticker];
      watchedSecurities[i].currentPrice = prices[watchedSecurities[i].ticker].price.toFixed(2);
    }
  }
  return res.render('watchlist.jade', {
    title: 'Watchlist',
    watchedSecurities: watchedSecurities
  });
};

/**
 * POST /watchlist/add
 */
exports.watchlistAdd = async function (req, res) {
  const ticker = req.body.ticker;
  let response;
  try {
    response = await rp({
      uri: `https://api.iextrading.com/1.0/stock/${ticker}/company`,
      json: true
    })
  } catch (err) {
    const msg = 'Network I/O failed to get company info from IEX.';
    console.error(msg);
    console.error(err);
    return res.send({success: false, msg});
  }
  let tickerIsValid = response.symbol !== undefined;
  if (!tickerIsValid) {
    return res.send({success: false, msg: 'Inputted ticker is invalid.'});
  }

  let watchlistRecord;
  try {
    watchlistRecord = await Watchlist.where({
      userId: req.user.attributes.id,
      ticker: ticker
    }).fetch();
  } catch (err) {
    const msg = 'Failed to read from database.';
    console.error(msg);
    console.error(err);
    return res.send({success: false, msg});
  }
  if (watchlistRecord !== null) {
    return res.send({success: false, msg: 'User is already watching this security.'});
  }

  let price = req.body.price;
  if (price === undefined) {
    try {
      price = await rp({
        uri: `https://api.iextrading.com/1.0/stock/${ticker}/price`
      });
    } catch (err) {
      const msg = `Failed to get price from IEX.`;
      console.error(msg);
      console.error(err);
      return res.send({success: false, msg})
    }
  }

  try {
    let item = await new Watchlist({
      userId: req.user.attributes.id,
      ticker: ticker,
      initialPrice: price,
      dateAdded: new Date()
    }).save()
  } catch (err) {
    const msg = 'Failed to create item.';
    console.error(msg);
    console.error(err);
    return res.send({success: false, msg})
  }
  
  return res.send({success: true})
};

/**
 * GET /watchlist/:itemId/delete
 */
exports.watchlistDelete = async function (req, res) {
  let watchlist;
  try {
    watchlist = await new Watchlist('id', req.params.itemId).fetch();
  } catch (err) {
    const msg = `The chosen item could not be found.`;
    console.error(msg);
    console.error(err);
    return res.render('error', {msg, title: 'Error'});
  }
  if (watchlist.attributes.userId != req.user.attributes.id) {
    return res.render('error', {msg: 'You are not authorized to do that.', title: 'Error'});
  }
  await watchlist.destroy();
  req.flash('success', {msg: 'The selected security has been deleted from your watchlist.'})
  return res.redirect('/watchlist');
}