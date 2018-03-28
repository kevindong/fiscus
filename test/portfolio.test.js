let request = require('supertest');
let server = require('../server');
let User = require('../models/User');
let Portfolio = require('../models/Portfolio');

describe('Portfolio Tests', function () {
  const userDetails = {
    email: 'test@test.com',
    password: 'test123'
  };

  let agent = request.agent(server); // Create agent to login to
  let user;
  let portfolio;

  // create portfolio for user
  before(async function(done) {
    agent.post('/login')
      .send(userDetails)
      .expect(302)
      .expect('Location', '/')
      .end(function (err, response) {
        if (err) {
          done(err);
        } else {
          done();
        }
      });

    user = await new User({email: userDetails.email}).fetch();
    portfolio = await new Portfolio({userId: user.attributes.id}).save();
  });

  // cleanup after tests
  after(function (done) {
    new Portfolio()
      .where({ userId: user.attributes.id })
      .destroy();
    done();
  });

  describe('keepFresh() Tests', function() {

    let values = [
      {
        date:"2018-03-23",
        stocks:[{ticker:"GE",shares:1}],
        cash:0,
        value:13.07
      },
      {
        date:"2018-03-26",
        stocks:[{ticker:"GE",shares:1}],
        cash:0,
        value:12.89
      }
      ];

    before(async function() {
      portfolio.attributes.value = values;
      await portfolio.save();
    });


    it('Test Buy with Securities Owned', function(done) {

    })
  });



  // describe('Buy stock with no current portfolio', function () {
  //   it('should redirect to login page', function (done) {
  //     agent.get('/admin')
  //       .expect(302)
  //       .expect('Location', '/login')
  //       .end(function (err, response) {
  //         if (err) {
  //           done(err);
  //         } else {
  //           done();
  //         }
  //       });
  //   });
  // });

  // before('POST /login as an admin user', function () {
  //   agent.post('/login')
  //     .send(userDetails)
  //     .expect(302)
  //     .expect('Location', '/')
  //     .end(function (err, response) {
  //       if (err) {
  //         done(err);
  //       } else {
  //         done();
  //       }
  //     });
  // });

  // describe('GET /admin as an admin user', function () {
  //   it('should return ok', function (done) {
  //     agent.get('/admin')
  //       .expect(200)
  //       .end(function (err, response) {
  //         if (err) {
  //           done(err);
  //         } else {
  //           done();
  //         }
  //       });
  //   });
  // });
});
