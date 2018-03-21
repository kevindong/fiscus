var bookshelf = require('../config/bookshelf');
var User = require('../models/User');
var Portfolio = require('../models/Portfolio');

var CurrentSecurity = bookshelf.Model.extend({
    tableName: 'currentSecurities',
    hasTimestamps: true,
    user: function() {
        return this.belongsTo(User, 'userId');
    },
    portfolio: function() {
      return this.belongsTo(Portfolio, 'portfolioId');
    }
});

module.exports = CurrentSecurity;