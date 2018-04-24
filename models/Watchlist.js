var bookshelf = require('../config/bookshelf');
var User = require('../models/User');

var Watchlist = bookshelf.Model.extend({
  tableName: 'watchlist',
  hasTimestamps: true,
  user: function() {
    return this.belongsTo(User, 'userId');
  }
});

module.exports = Watchlist;