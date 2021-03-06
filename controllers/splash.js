const apikey = process.env.ALPHAVANTAGE_KEY;
const apiroot = 'https://www.alphavantage.co/query';
const deref = 'Time Series (Daily)';
const closeRef = '4. close';
const Bluebird = require('bluebird');
const rp = require('request-promise');
const iextradingRoot = 'https://api.iextrading.com/1.0';
const redis = require('redis');
const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
});
const { promisify } = require('util');
const redisGetAsync = promisify(redisClient.get).bind(redisClient);
const redisSetAsync = promisify(redisClient.set).bind(redisClient);

/**
 * GET /
 *
 * Splash page of market indices
 */
exports.index = function (req, res) {
  
  //Get the data from the cache,
  //which will automatically update itself if data is too old
  getSplashChartDataRedis()
    .then(async function (data) {

      
      // Format
      let spFormat = formatData(data.spResponse);
      let nsdqFormat = formatData(data.nsdqResponse);
      let djiaFormat = formatData(data.djiaResponse);
      
      let quotes = await getIndexQuotes();
      
      // Normalize
      let spNorm = normalizeData(spFormat, quotes.spQuote.previousClose);
      let nsdqNorm = normalizeData(nsdqFormat, quotes.nsdqQuote.previousClose);
      let djiaNorm = normalizeData(djiaFormat, quotes.djiaQuote.previousClose);
      
      res.render('splash', {
        title: 'Home',

        sp: quotes.spQuote.latestPrice.toFixed(2),
        spChng: quotes.spQuote.change.toFixed(2),
        spPctChng: (quotes.spQuote.changePercent * 100).toFixed(2) + '%',

        nsdq: quotes.nsdqQuote.latestPrice.toFixed(2),
        nsdqChng: quotes.nsdqQuote.change.toFixed(2),
        nsdqPctChng: (quotes.nsdqQuote.changePercent * 100).toFixed(2) + '%',

        djia: quotes.djiaQuote.latestPrice.toFixed(2),
        djiaChng: quotes.djiaQuote.change.toFixed(2),
        djiaPctChng: (quotes.djiaQuote.changePercent * 100).toFixed(2) + '%',

        spNormData: JSON.stringify(spNorm),
        nsdqNormData: JSON.stringify(nsdqNorm),
        djiaNormData: JSON.stringify(djiaNorm),
        
        dataLoad: true,
      });
    }).catch(function (err) {
      console.log(err);

      res.render('splash', {
        title: 'Home',

        sp: '-- --',
        spChng: '0.00',
        spPctChng: '0.00%',

        nsdq: '-- --',
        nsdqChng: '0.00',
        nsdqPctChng: '0.00%',

        djia: '-- --',
        djiaChng: '0.00',
        djiaPctChng: '0.00%',

        dataLoad: false,
      });
    });
};


/**
 * Formats a date into the format used by AlphaVantage API
 * @param date
 * @returns {string}
 */
function formatDate(date) {
  // Get yesterday's date
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


async function iexIntradayIndexGet() {
  const [spResponse, nsdqResponse, djiaResponse] = await Promise.all([
    intradayIndexGet('SPY'),
    intradayIndexGet('QQQ'),
    intradayIndexGet('DIA')
  ]).catch(function (err) {
    console.log(err);
  });

  return { spResponse, nsdqResponse, djiaResponse };
}


async function intradayIndexGet(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/chart/1d?filter=date,minute,average,volume`,
    json: true,
  });
}


const formatData = function (data) {
  for (i in data) {

    if (data[i].volume === 0) {
      data.splice(i, 1);
    } else {
      data[i].x = data[i].date.substring(0, 4) + '-' + data[i].date.substring(4, 6) + '-' + data[i].date.substring(6, 8) + ' ' + data[i].minute;
      data[i].y = data[i].average;
      delete data[i].date;
      delete data[i].minute;
      delete data[i].average;
    }

  }

  return data;
};


const normalizeData = function (data, prevClose) {

  let normData = [];

  for (i in data) {
    let obj = {};
    obj.x = data[i].x;
    obj.y = (data[i].y - prevClose) * 100 / prevClose;
    normData.push(obj);
  }

  return normData;
};


const getQuote = function (ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/quote/1d?filter=previousClose,change,changePercent,latestPrice`,
    json: true,
  });
};


async function getIndexQuotes() {
  const [spQuote, nsdqQuote, djiaQuote] = await Promise.all([
    getQuote('SPY'),
    getQuote('QQQ'),
    getQuote('DIA')
  ]).catch(function (err) {
    console.log(err);
  });

  return { spQuote, nsdqQuote, djiaQuote };
}

/**
 * Update the chart data in redis and return the value set to
 */
const updateSplashChartDataRedis = async () => {
  const data = iexIntradayIndexGet();
  try {
    redisSetAsync('splashChart', JSON.stringify(await data), 'EX', 60); //Save for 1 minute
    return data;
  } catch (e) {
    console.log(e);
  }
};

/**
* Get the splash chart data from redis
*/
const getSplashChartDataRedis = async () => {
  try {
    const data = redisGetAsync('splashChart');
    if (await data === null) {
      throw new Error('Redis: chart data needs updating.');
    }
    return JSON.parse(await data);
  } catch (e) {
      //There was an error getting the data from redis
      //It might have expired, update it and retry
      console.log(e);
      const data = await updateSplashChartDataRedis();
      return data;
  }
};