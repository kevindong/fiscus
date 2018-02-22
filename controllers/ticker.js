const iextradingRoot = 'https://api.iextrading.com/1.0';
const rp = require('request-promise');

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
        });
    } catch (e) {
        req.flash('error', {msg: `${ticker} is either an invalid or unsupported ticker.`});
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
    const validExchanges = ['NAS', 'NYSE', 'NYQ', 'ASE'];
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
    const validExchanges = ['NAS', 'NYSE', 'NYQ', 'ASE'];
    return rp({uri, json:true,})
        .then((response) => {
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
}

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