const iextradingRoot = 'https://api.iextrading.com/1.0';
const rp = require('request-promise');
const validExchanges = ['NAS', 'NYSE', 'NYQ', 'NYS', 'ASE', 'PCX']; //Used as a whitelist for Yahoo name completion

/*
 * GET /ticker/details/[ticker]
 * Displays the details page for [ticker]
 */
exports.tickerDetailsGet = async function(req, res) {
    const ticker = req.params.ticker;
    try {
        const ohlc = await exports.iexOpenHighLowCloseGet(ticker);
        const news = await exports.iexNews(ticker);
        const {name, exchange} = await exports.yahooNameExchangeGet(ticker);
        const financials = await exports.iexFinancialsGet(ticker);
        const keyStats = await exports.iexKeyStatsGet(ticker);
        const logo = await exports.iexLogoGet(ticker);
        const quote = await exports.iexQuoteGet(ticker);
        const chartData = await exports.iexChartGet(ticker, '1d');
        const chart = formatData(chartData);
        const chartYearData = await exports.iexYearChartGet(ticker);
        const chartYear = await formatYearData(chartYearData);
        const dividends = formatDividends(await getDividends(ticker));
        const splits = formatSplits(await getSplits(ticker));
        const lastPrice = quote.latestPrice;
        const closePrice = ohlc.close.price;
        const previousClose = quote.previousClose;
        const change = lastPrice - previousClose;
        const changeFormatted = `${(change >= 0) ? '+' : ''}${parseInt(change*100)/100}`;
        const percentChange = lastPrice / previousClose;
        const percentChangeFormatted = `${(percentChange >= 1) ? '+'+(parseInt((percentChange-1)*10000)/100) : '-'+(parseInt((1-percentChange)*10000)/100)}%`;
        const open = ohlc.open.price;
        const close = ohlc.close.price;
        const low = ohlc.low;
        const high = ohlc.high;
        const color = (change >= 0) ? '#4CAF50' : '#F44336';
        const baseline = [{x: chart[0].x, y: previousClose}, {x: chart[chart.length-1].x, y: previousClose}];
        res.render('details', { 
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
            chartData: JSON.stringify(chart),
            chartColor: JSON.stringify(color),
            baseline: JSON.stringify(baseline),
            chartYear: JSON.stringify(chartYear),
            annotations: JSON.stringify(dividends.concat(splits))
        });
    } catch (e) {
        console.log(e);
        req.flash('error', {msg: `${ticker} is either an invalid or unsupported ticker.`});
        console.log(e);
        res.redirect('/');
    }
};

/*
 * GET /ticker/lookup?text=[text]
 * Looks up [text] and returns the best matched tickers
 */
exports.lookupTickerGet = function(req, res) {
    if (!req.query.text)
        return res.send({ results: [] });
    const url = `http://d.yimg.com/aq/autoc?query=${req.query.text}&region=US&lang=en-US`;
    rp(url)
        .then((response) => {
            const data = JSON.parse(response);
            const tickers = data['ResultSet']['Result'].filter((obj) => validExchanges.includes(obj.exch));
            const select2format = { results: tickers.map((obj) => { return { id: obj.symbol, text: `${obj.symbol} - ${obj.name}` }; })};
            res.send(select2format);
        })
        .catch((err) => {
            res.status(400).send('There was an error');
            console.log(err);
        });
};

exports.yahooNameExchangeGet = async function(ticker) {
    const uri = `http://d.yimg.com/aq/autoc?query=${ticker}&region=US&lang=en-US`;
    return rp({uri, json:true,})
        .then((response) => {
            if (response['ResultSet']['Result'].length === 0)
                return Promise.resolve({name: '', exchange: ''});
            const tickers = response['ResultSet']['Result'].filter((obj) => validExchanges.includes(obj.exch));
            return Promise.resolve({name: tickers[0].name, exchange: tickers[0].exchDisp});
        });
};

exports.iexPriceGet = async function(ticker) {
    return rp(`${iextradingRoot}/stock/${ticker}/price`);
};

exports.iexOpenHighLowCloseGet = async function(ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/ohlc`,
        json: true,
    });
};

exports.iexNews = async function(ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/news/last/6`,
        json: true,
    });
};

exports.iexFinancialsGet = async function(ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/financials`,
        json: true,
    });
};

exports.iexLogoGet = async function(ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/logo`,
        json: true,
    });
};

exports.iexKeyStatsGet = async function(ticker) {
    return rp({
        uri: `${iextradingRoot}/stock/${ticker}/stats`,
        json: true,
    });
};

exports.iexQuoteGet = async function(ticker) {
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
const formatMoney = function(money) {
    if (!money)
        return '?';
    return money.toFixed(2).replace(/(\d)(?=(\d{3})+\.)/g, '$1,');
};

exports.iexChartGet = async function(ticker, timeFrame) {
    return rp({
      uri: `${iextradingRoot}/stock/${ticker}/chart/${timeFrame}?filter=date,minute,marketAverage`,
      json: true,
    });
};


const formatData = function(data) {
  for(i in data) {

    if(data[i].marketAverage === 0) {
      data.splice(i, data.length-i);

      return data;
    }

    data[i].x = data[i].date.substring(0,4) + '-' + data[i].date.substring(4,6) + '-' + data[i].date.substring(6,8) + ' ' +  data[i].minute;
    data[i].y = data[i].marketAverage;
    delete data[i].date;
    delete data[i].minute;
    delete data[i].marketAverage;
  }

  return data;
};

exports.iexYearChartGet = async function(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/chart/1y?filter=date,close`,
    json: true,
  });
};


const formatYearData = function(data) {
    for(i in data) {
        data[i].x = data[i].date;
        data[i].y = data[i].close;

        delete data[i].date;
        delete data[i].close;
    }

    return data;
};

const getDividends = async function(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/dividends/1y?filter=paymentDate,amount`,
    json: true,
  });
};

const formatDividends = function(data) {

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

    for(i in data) {
        let temp = Object.assign({}, divTemplate);
        temp.value = data[i].paymentDate;
        temp.label.content = 'Dividend Paid: $' + data[i].amount;
        dividends.push(temp);
    }

    console.log(dividends);

    return dividends;

};

const getSplits = async function(ticker) {
  return rp({
    uri: `${iextradingRoot}/stock/${ticker}/splits/1y?filter=paymentDate,ratio`,
    json: true,
  });
};

const formatSplits = function(data) {
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

  for(i in data) {
    let temps = Object.assign({}, splitTemplate);
    temps.value = data[i].paymentDate;
    splits.push(temps);
  }

  console.log(splits);

  return splits;
};