
const iextradingRoot = 'https://api.iextrading.com/1.0';
const rp = require('request-promise');
const redis = require('redis');
const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
});
const { promisify } = require('util');
const redisGetAsync = promisify(redisClient.get).bind(redisClient);
const redisSetAsync = promisify(redisClient.set).bind(redisClient);

/*
 * GET /ticker/details/[ticker]
 * Displays the details page for [ticker]
 */
exports.tickerDetailsGet = async function (req, res) {
    const ticker = req.params.ticker;
    try {
        const ohlc = await exports.iexOpenHighLowCloseGet(ticker);
        const news = await exports.iexNews(ticker);
        const { name, exchange } = await exports.yahooNameExchangeGet(ticker);
        const financials = await exports.iexFinancialsGet(ticker);
        const keyStats = await exports.iexKeyStatsGet(ticker);
        const logo = await exports.iexLogoGet(ticker);
        const quote = await exports.iexQuoteGet(ticker);

        const dayData = await exports.iexDayChartGet(ticker, '1d');
        const chartDay = formatDayData(dayData);



        // const monthData = await exports.iexChartGet(ticker, '1m');
        // const chartMonth = await formatData(monthData);
        //
        // const thrMonthData = await exports.iexChartGet(ticker, '3m');
        // const chartThrMonth = await formatData(thrMonthData);

        const chartYearData = await exports.iexChartGet(ticker, '1y');
        const chartYear = await formatData(chartYearData);

        const chartMonth = await getMonthData(chartYearData);
        const chartThrMonth = await getThrMonthData(chartYearData);

        const dividends = formatDividends(await getDividends(ticker));
        const splits = formatSplits(await getSplits(ticker));
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
        const baseline = [{ x: chartDay[0].x, y: previousClose }, { x: chartDay[chartDay.length - 1].x, y: previousClose }];
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
            financials: financials['financials'][0], //Pass only the most recent financial data... for now.
            formatMoney, //function to format money, useful in view
            logoUrl: logo.url,
            keyStats,
            chartDay: JSON.stringify(chartDay),
            chartMonth: JSON.stringify(chartMonth),
            chartThrMonth: JSON.stringify(chartThrMonth),
            chartYear: JSON.stringify(chartYear),
            chartColor: JSON.stringify(color),
            baseline: JSON.stringify(baseline),
            annotations: JSON.stringify(dividends.concat(splits))
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
    return money.toFixed(2).replace(/(\d)(?=(\d{3})+\.)/g, '$1,');
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
    for (i in data) {

        if ((data[i].average === 0) && (data[i].volume === 0)) {
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