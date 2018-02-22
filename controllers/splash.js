const apikey = process.env.ALPHAVANTAGE_KEY;
const apiroot = 'https://www.alphavantage.co/query';
const deref = 'Time Series (Daily)';
const closeRef = '4. close';
const Bluebird = require('bluebird');
const rp = require('request-promise');


/**
 * GET /
 *
 * Splash page of market indices
 */
exports.index = function(req, res) {
  getLastData().then(function(data) {

    if(isToday(data.spCurrDate)) {
      let chgData = getChgData(data.spCurrData,
        data.spLastData,
        data.djiaCurrData,
        data.djiaLastData,
        data.nsdqCurrData,
        data.nsdqLastData);

      res.render('splash', {
        title: 'Splash',
        sp: chgData.spPctChng.toFixed(2) + '%',
        spChg: chgData.spChng.toFixed(2),
        spClose: parseFloat(data.spCurrData[closeRef]).toFixed(2),
        nsdq: chgData.nsdqPctChng.toFixed(2) + '%',
        nsdqChg: chgData.nsdqChng.toFixed(2),
        nsdqClose: parseFloat(data.nsdqCurrData[closeRef]).toFixed(2),
        djia: chgData.djiaPctChng.toFixed(2) + '%',
        djiaChg: chgData.djiaChng.toFixed(2),
        djiaClose: parseFloat(data.djiaCurrData[closeRef]).toFixed(2),
        dataLoad: true
      });

    } else {
      res.render('splash', {
        title: 'Splash',
        sp: '0.00%',
        spChg: '0.00',
        spClose: parseFloat(data.spCurrData[closeRef]).toFixed(2),
        nsdq: '0.00%',
        nsdqChg: '0.00',
        nsdqClose: parseFloat(data.nsdqCurrData[closeRef]).toFixed(2),
        djia: '0.00%',
        djiaChg: '0.00',
        djiaClose: parseFloat(data.djiaCurrData[closeRef]).toFixed(2),
        dataLoad: true
      });
    }
  }).catch(function(err) {
    console.log(err);

    res.render('splash', {
      title: 'Splash',
      sp: '0.00%',
      spChg: '0.00',
      spClose: '-- --',
      nsdq: '0.00%',
      nsdqChg: '0.00',
      nsdqClose: '-- --',
      djia: '0.00%',
      djiaChg: '0.00',
      djiaClose: '-- --',
      dataLoad: false
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
  let mm = date.getMonth()+1; //January is 0!
  let yyyy = date.getFullYear();

  if(dd<10){
    dd='0'+dd;
  }
  if(mm<10){
    mm='0'+mm;
  }
  return (yyyy+'-'+mm+'-'+dd);
}


/**
 * Gets the last values of important indices of the stock market
 * @returns {Promise.<TResult>|*}
 */
function lastValues() {

  let today = new Date();
  let day = new Date();


  day.setDate(today.getDate() - 1);

  return marketOpen(day).then(function (isOpen) {

    if (isOpen) {
      return getValues(day);
    } else {
      day.setDate(today.getDate() - 2);
      return marketOpen(day).then(function (isOpen) {

        if (isOpen) {
          return getValues(day);
        } else {
          day.setDate(today.getDate() - 3);
          return marketOpen(day).then(function(isOpen) {

            if(isOpen) {
              return getValues(day);
            } else {
              return 'error';
            }
          })
        }

      });
    }
  });
}


/**
 * Gets the last two days of data for all the major indices
 * @returns {Promise.<T>}
 */
function getLastData() {

  const spApiUrl =
    `${apiroot}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=SPX&apikey=${apikey}`; // S&P 500
  const nsdqApiUrl =
    `${apiroot}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=IXIC&apikey=${apikey}`; // NASDAQ
  const djiaApiUrl =
    `${apiroot}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=DJI&apikey=${apikey}`; // Dow Jones Industrial Average

  let spRequest = rp(spApiUrl);
  let nsdqRequest = rp(nsdqApiUrl);
  let djiaRequest = rp(djiaApiUrl);

  return Bluebird.all([spRequest, nsdqRequest, djiaRequest])
    .spread(function(spResponse, nsdqResponse, djiaResponse) {

      // S&P 500 Processing
      let spData = JSON.parse(spResponse);

      let spCurrDate = Object.keys(spData[deref])[0];
      let spCurrData = spData[deref][spCurrDate];

      let spLastDate = Object.keys(spData[deref])[1];
      let spLastData = spData[deref][spLastDate];

      // DOW Processing
      let djiaData = JSON.parse(djiaResponse);

      let djiaCurrDate = Object.keys(djiaData[deref])[0];
      let djiaCurrData = djiaData[deref][djiaCurrDate];

      let djiaLastDate = Object.keys(djiaData[deref])[1];
      let djiaLastData = djiaData[deref][djiaLastDate];


      // NASDAQ Processing
      let nsdqData = JSON.parse(nsdqResponse);

      let nsdqCurrDate = Object.keys(nsdqData[deref])[0];
      let nsdqCurrData = nsdqData[deref][nsdqCurrDate];

      let nsdqLastDate = Object.keys(nsdqData[deref])[1];
      let nsdqLastData = nsdqData[deref][nsdqLastDate];

      return {spCurrDate,
        spCurrData,
        spLastDate,
        spLastData,
        djiaCurrDate,
        djiaCurrData,
        djiaLastDate,
        djiaLastData,
        nsdqCurrDate,
        nsdqCurrData,
        nsdqLastDate,
        nsdqLastData
      };
    }).catch(function(err) {
      console.log(err);
      return err;
  }).timeout(3000, new Error('Request not fulfilled within 3 seconds.'));
}


/**
 * Tells whether the latest data is from today or not
 *
 * @param date
 * @returns {boolean}
 */
function isToday(date) {
  let today = formatDate(new Date());

  return (date === today);
}


/**
 * Gets the change to the index on the day
 *
 * @param spCurrData
 * @param spLastData
 * @param djiaCurrData
 * @param djiaLastData
 * @param nsdqCurrData
 * @param nsdqLastData
 * @returns {{spChng: number, spPctChng: number, djiaChng: number, djiaPctChng: number, nsdqChng: number, nsdqPctChng: number}}
 */
function getChgData(spCurrData, spLastData, djiaCurrData, djiaLastData, nsdqCurrData, nsdqLastData) {

  let spChng = spCurrData[closeRef] - spLastData[closeRef];
  let spPctChng = 100 * spChng / spLastData[closeRef];

  let djiaChng = djiaCurrData[closeRef] - djiaLastData[closeRef];
  let djiaPctChng = 100 * djiaChng / djiaLastData[closeRef];

  let nsdqChng = nsdqCurrData[closeRef] - nsdqLastData[closeRef];
  let nsdqPctChng = 100 * nsdqChng / nsdqLastData[closeRef];

  return {spChng, spPctChng, djiaChng, djiaPctChng, nsdqChng, nsdqPctChng}
}