var bookshelf = require('../config/bookshelf');
var User = require('../models/User');

var Portfolio = bookshelf.Model.extend({
    tableName: 'portfolios',
    hasTimestamps: true,
    user: function() {
        return this.belongsTo(User, 'userId');
    }
});

module.exports = Portfolio;