
const iextradingRoot = 'https://api.iextrading.com/1.0';
const rp = require('request-promise');
const Portfolio = require('../models/Portfolio');
const Watchlist = require('../models/Watchlist');
const Transaction = require('../models/Transaction');
const CurrentSecurity = require('../models/CurrentSecurity');
const redis = require('redis');
const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
});
const { promisify } = require('util');
const redisGetAsync = promisify(redisClient.get).bind(redisClient);
const redisSetAsync = promisify(redisClient.set).bind(redisClient);

/*
 * GET /ticker/details/[ticker]
 * GET /ticker/details/[ticker]/compare/[compare]
 * Displays the details page for [ticker]
 */
exports.tickerDetailsGet = async function (req, res) {
    const ticker = req.params.ticker;
    const compare = req.params.compare;
    try {
        const [
            ohlc, 
            news, 
            { name, exchange }, 
            financials, 
            keyStats, 
            logo, 
            quote, 
            dayData, 
            chartYearData,
            securityOwnershipInfo,
            transactions,
            dividends,
            splits
        ] = await Promise.all([
            exports.iexOpenHighLowCloseGet(ticker),
            exports.iexNews(ticker),
            exports.yahooNameExchangeGet(ticker),
            exports.iexFinancialsGet(ticker),
            exports.iexKeyStatsGet(ticker),
            exports.iexLogoGet(ticker),
            exports.iexQuoteGet(ticker),
            exports.iexDayChartGet(ticker, '1d'),
            exports.iexChartGet(ticker, '1y'),
            getSecurityOwnershipInfo(req, ticker),
            getSecurityTransactionInfo(req, ticker),
            getDividends(ticker),
            getSplits(ticker)
        ]);
        const [
            chartYear,
            chartMonth,
            chartThrMonth
        ] = await Promise.all([
            formatData(chartYearData),
            getMonthData(chartYearData),
            getThrMonthData(chartYearData)
        ]);

        const chartDay = formatDayData(dayData);

        let baseline;
        let validDayGraph;
        if(chartDay.length === 0) {
          validDayGraph = false;
          baseline = null;
        } else {
          validDayGraph = true;
          baseline = [{ x: chartDay[0].x, y: quote.previousClose }, { x: chartDay[chartDay.length - 1].x, y: quote.previousClose }];
        }

        const formattedDividends = formatDividends(dividends);
        const formattedSplits = formatSplits(splits);
        const lastPrice = quote.latestPrice;
        const closePrice = ohlc.close.price;
        const previousClose = quote.previousClose;
        const change = lastPrice - previousClose;
        const changeFormatted = `${(change >= 0) ? '+' : ''}${parseInt(change * 100) / 100}`;
        const percentChange = lastPrice / previousClose;
        const percentChangeFormatted = `${(percentChange >= 1) ? '+' + (parseInt((percentChange - 1) * 10000) / 100) : '-' + (parseInt((1 - percentChange) * 10000) / 100)}%`;
        const open = ohlc.open.price;
        const close = ohlc.close.price;
        const low = ohlc.low;
        const high = ohlc.high;
        const color = (change >= 0) ? '#4CAF50' : '#F44336';

        
        let watchlist = null;
        if (req.user) {
            watchlist = await new Watchlist().where({
                userId: req.user.attributes.id,
                ticker: ticker
            }).fetch();
        }
        if (watchlist != null) {
            watchlist = watchlist.attributes;
        }
        // if compare exists, fetch its data too
        let dayData2;
        let chartYearData2;
        let chartYear2;
        let chartMonth2;
        let chartThrMonth2;
        let chartDay2;
        if (compare) {
            [
                dayData2,
                chartYearData2
            ] = await Promise.all([
                exports.iexDayChartGet(compare, '1d'),
                exports.iexChartGet(compare, '1y')
            ]);
            // refractor data as percentage gains
            let start = chartYearData[0].y;
            let start2 = chartYearData2[0].close;
            chartYearData.forEach(e => {
                e.y = 100 * (e.y - start) / start;
            });
            chartYearData2.forEach(e => {
                e.close = 100 * (e.close - start2) / start2;
            });
            [
                chartYear2,
                chartMonth2,
                chartThrMonth2
            ] = await Promise.all([
                formatData(chartYearData2),
                getMonthData(chartYearData2),
                getThrMonthData(chartYearData2)
            ]);
            chartDay2 = formatDayData(dayData2);
        }

        const actualFinancials = (financials.financials) ? financials.financials[0] : {};
        res.render('details', {
            title: ticker + ' - Details',
            ticker,
            lastPrice,
            change,
            changeFormatted,
            percentChangeFormatted,
            open,
            close,
            low,
            high,
            news,
            name,
            exchange,
            financials: actualFinancials, //Pass only the most recent financial data... for now.
            formatMoney, //function to format money, useful in view
            logoUrl: logo.url,
            keyStats,
            securityOwnershipInfo,
            transactions,
            chartDay: JSON.stringify(chartDay),
            chartMonth: JSON.stringify(chartMonth),
            chartThrMonth: JSON.stringify(chartThrMonth),
            chartYear: JSON.stringify(chartYear),
            chartColor: JSON.stringify(color),
            baseline: JSON.stringify(baseline),
            annotations: JSON.stringify(formattedDividends.concat(formattedSplits)),
            validDayGraph,
            watchlist,
            // optional parameters for compare view only
            compare,
            chartDay2: (chartDay2) ? JSON.stringify(chartDay2) : 'undefined',
            chartMonth2: (chartMonth2) ? JSON.stringify(chartMonth2) : 'undefined',
            chartThrMonth2: (chartThrMonth2) ? JSON.stringify(chartThrMonth2) : 'undefined',
            chartYear2: (chartYear2) ? JSON.stringify(chartYear2) : 'undefined'
        });
    } catch (e) {
        console.log(e);
        req.flash('error', { msg: `${ticker} is either an invalid or unsupported ticker.` });
        console.log(e);
        res.redirect('/');
    }
};

/*
 * GET /ticker/lookup?text=[text]
 * Looks up [text] and returns the best matched tickers
 */
exports.lookupTickerGet = async function (req, res) {
    if (!req.query.text)
        return res.send({ results: [] });
    const url = `http://d.yimg.com/aq/autoc?query=${req.query.text}&region=US&lang=en-US`;
    const knownTickers = await getKnownTickersRedis();
    rp(url)
        .then((response) => {
            const data = JSON.parse(response);
            const tickers = data['ResultSet']['Result'].filter((obj) => knownTickers.includes(obj.symbol));
            const select2format = { results: tickers.map((obj) => { return { id: obj.symbol, text: `${obj.symbol} - ${obj.name}` }; }) };
            res.send(select2format);
        })
        .catch((err) => {
            res.status(400).send('There was an error');
            console.log(err);
        });
};

exports.yahooNameExchangeGet = async function(ticker) {
    if (ticker === "$") {
        return {name: 'Cash'};
    }
    const uri = `http://d.yimg.com/aq/autoc?query=${ticker}&region=US&lang=en-US`;
    const getKnownTickers = getKnownTickersRedis();
    return rp({ uri, json: true, })
        .then(async (response) => {
            if (response['ResultSet']['Result'].length === 0)
                return Promise.resolve({ name: '', exchange: '' });
            const knownTickers = await getKnownTickers;
            const tickers = response['ResultSet']['Result'].filter((obj) => knownTickers.includes(obj.symbol));
            return Promise.resolve({ name: tickers[0].name, exchange: tickers[0].exchDisp });
        });
};

exports.iexPriceGet = async function (ticker) {
    return rp(`${iextradingRoot}/stock/${ticker}/price`);
};

exports.iexOpenHighLowCloseGet = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/ohlc`,
        json: true,
    });
};

exports.iexNews = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/news/last/6`,
        json: true,
    });
};

exports.iexFinancialsGet = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/financials`,
        json: true,
    });
};

exports.iexLogoGet = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/logo`,
        json: true,
    });
};

exports.iexKeyStatsGet = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/stats`,
        json: true,
    });
};

exports.iexQuoteGet = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/quote`,
        json: true,
    });
};

/*
 * Used to format money in the view
 * Returns '-' if money is null/undefined
 * This allows the API to have null entries for some values
 */
const formatMoney = function (money) {
    if (!money)
        return '?';
    if (Math.abs(money) >= 1000000000000)
        return `${(money / 1000000000000).toFixed(2)}T`;
    if (Math.abs(money) >= 1000000000)
        return `${(money / 1000000000).toFixed(2)}B`;
    if (Math.abs(money) >= 1000000)
        return `${(money / 1000000).toFixed(2)}M`;
    return money.toFixed(2).replace(/(\d)(?=(\d{3})+\.)/g, '$1,');;
};

exports.iexDayChartGet = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/chart/1d?filter=date,minute,average,volume`,
        json: true,
    });
};

exports.iexChartGet = async function (ticker, timeframe) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/chart/${timeframe}?filter=date,close`,
        json: true,
    });
};


const formatDayData = function (data) {
    let newData = [];
  for (let i = 0; i < data.length; i++) {

    if (data[i].volume === 0) {
        //copy.splice(i, 1);
    } else {
        let el = {};
        el.x = data[i].date.substring(0, 4) + '-' + data[i].date.substring(4, 6) + '-' + data[i].date.substring(6, 8) + ' ' + data[i].minute;
        el.y = data[i].average;
        newData.push(el);
    }

  }

  return newData;
};

const getIndexOfDate = function (date, array) {

    for (i in array) {
        if (array[i].x === date) {
            return i;
        }
    }
    return -1;
};

const getMonthData = function (data) {
    let today = new Date();
    let yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    let startDate = new Date();

    startDate.setDate(yesterday.getDate());
    startDate.setMonth(yesterday.getMonth() - 1);

    let start = formatDate(startDate);

    let ind = getIndexOfDate(start, data);

    if (ind === -1) {
        return data.slice(-20);
    } else {
        return data.slice(ind);
    }
};

const getThrMonthData = function (data) {
    let today = new Date();
    let yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    let startDate = new Date();

    startDate.setDate(yesterday.getDate());
    startDate.setMonth(yesterday.getMonth() - 3);

    let start = formatDate(startDate);

    let ind = getIndexOfDate(start, data);

    if (ind === -1) {
        return data.slice(-60);
    } else {
        return data.slice(ind);
    }
};


const formatData = function(data) {
    for(i in data) {
        data[i].x = data[i].date;
        data[i].y = data[i].close;

        delete data[i].date;
        delete data[i].close;
    }

    return data;
};

const getDividends = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/dividends/1y?filter=paymentDate,amount`,
        json: true,
    });
};

const formatDividends = function (data) {

    const divTemplate = {
        type: 'line',
        mode: "vertical",
        scaleID: "x-axis-0",
        value: "2017-05-14",
        borderColor: "#4CAF50",
        label: {
            content: "TODAY",
            enabled: true,
            position: "top"
        }
    };

    let dividends = [];

    for (i in data) {
        let temp = Object.assign({}, divTemplate);
        temp.value = data[i].paymentDate;
        temp.label.content = 'Dividend Paid: $' + data[i].amount;
        dividends.push(temp);
    }

    return dividends;

};

const getSplits = async function (ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/splits/1y?filter=exDate,ratio`,
        json: true,
    });
};

const formatSplits = function (data) {
    const splitTemplate = {
        type: 'line',
        mode: "vertical",
        scaleID: "x-axis-0",
        value: "2017-05-14",
        borderColor: "#2196F3",
        label: {
            content: "Split",
            enabled: true,
            position: "top"
        }
    };

    let splits = [];

    for (i in data) {
        let temps = Object.assign({}, splitTemplate);
        temps.value = data[i].exDate;
        splits.push(temps);
    }

    return splits;
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


/**
 * Update the known tickers in redis
 */
const updateKnownTickersRedis = async () => {
    const tickers = rp(`${iextradingRoot}/ref-data/symbols`);
    try {
        //Parse iex into an object, remove disabled tickers, and save only the ticker/symbol
        const filteredTickers = JSON.parse(await tickers).filter((obj) => obj.isEnabled).map((obj) => obj.symbol);
        return redisSetAsync('knownTickers', JSON.stringify(filteredTickers), 'EX', 24 * 60 * 60); //Save for 1 day
    } catch (e) {
        console.log(e);
    }
};

/**
 * Get the known tickers from redis
 */
const getKnownTickersRedis = async () => {
    try {
        const tickers = redisGetAsync('knownTickers');
        if (await tickers === null) {
            throw new Error('Redis: knownTickers needs updating.');
        }
        return tickers;
    } catch (e) {
        //There was an error getting the data from redis
        //It might have expired, update it and retry
        console.log(e);
        await updateKnownTickersRedis();
        const tickers = redisGetAsync('knownTickers');
        return tickers;
    }
};

const getSecurityOwnershipInfo = async (req, ticker) => {
    if (!req.user) {
        //They can't own any stock if they're not logged in...
        return;
    }
    let portfolio;
    try {
        portfolio = await new Portfolio().where('userId', req.user.attributes.id).fetch();
    } catch (err) {
        const msg = `Error in getting user's portfolio.`;
        console.error(msg);
        console.error(err);
    }
    if (!portfolio) {
        return;
    }
    let currentSecurity;
    try {
        currentSecurity = await new CurrentSecurity().where({portfolioId: portfolio.attributes.id, ticker}).fetch();
    } catch (err) {
        const msg = `Error in getting current securities.`;
        console.error(msg);
        console.error(err);
    }
    if (!currentSecurity) {
        return;
    }
    return currentSecurity;
};

const getSecurityTransactionInfo = async (req, ticker) => {
    if (!req.user) {
        //There can't be any transactions if they're not logged in...
        return;
    }
    let portfolio;
    try {
        portfolio = await new Portfolio().where('userId', req.user.attributes.id).fetch();
    } catch (err) {
        const msg = `Error in getting user's portfolio.`;
        console.error(msg);
        console.error(err);
    }
    let transactions;
    try {
        transactions = await new Transaction().where({portfolioId: portfolio.attributes.id, ticker}).fetchAll();
    }  catch (err) {
        const msg = `Error in getting transactions.`;
        console.error(msg);
        console.error(err);
    }
    if (!transactions) {
        return;
    }
    return transactions.models;
};