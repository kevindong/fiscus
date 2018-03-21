var bookshelf = require('../config/bookshelf');
var User = require('../models/User');
var Portfolio = require('../models/Portfolio');

var Transaction = bookshelf.Model.extend({
    tableName: 'transactions',
    hasTimestamps: true,
    user: function() {
        return this.belongsTo(User, 'userId');
    },
    portfolio: function() {
      return this.belongsTo(Portfolio, 'portfolioId');
    }
});

module.exports = Transaction;