exports.up = function(knex, Promise) {
  return Promise.all([
    knex.schema.createTable('users', function(table) {
      table.increments();
      table.string('name').notNullable();
      table.string('email').unique().notNullable();
      table.string('password').notNullable();
      table.boolean('isAdmin').notNullable();
      table.boolean('isBanned').notNullable();
      table.boolean('isConfirmed').notNullable();
      table.string('emailToken');
      table.string('passwordResetToken');
      table.dateTime('passwordResetExpires');
      table.timestamps();
    })
  ]);
};

exports.down = function(knex, Promise) {
  return Promise.all([
    knex.schema.dropTable('users')
  ])
};