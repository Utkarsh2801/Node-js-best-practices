// We will store the query as a key of the redis cache

const mongoose = require("mongoose");
const redis = require("redis");
const util = require("util");
const keys = require("../config/keys");

const client = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000,
});
client.hget = util.promisify(client.hget);
const exec = mongoose.Query.prototype.exec;

mongoose.Query.prototype.cache = function (options = { time: 60 }) {
  this.useCache = true;
  this.time = options.time;
  this.hashKey = JSON.stringify(options.key || this.mongooseCollection.name);

  return this;
};

mongoose.Query.prototype.exec = async function () {
  if (!this.useCache) {
    return await exec.apply(this, arguments);
  }

  const key = JSON.stringify({
    ...this.getQuery(),
  });

  const cacheValue = await client.hget(this.hashKey, key);

  if (cacheValue) {
    const doc = JSON.parse(cacheValue);

    console.log("Response from Redis");
    return Array.isArray(doc)
      ? doc.map((d) => new this.model(d))
      : new this.model(doc);
  }

  const result = await exec.apply(this, arguments);
  console.log(this.time);
  client.hset(this.hashKey, key, JSON.stringify(result));
  client.expire(this.hashKey, this.time);

  console.log("Response from MongoDB");
  return result;
};

module.exports = {
  clearKey(hashKey) {
    client.del(JSON.stringify(hashKey));
  },
};

/************************************************************************/

// Route Files

const mongoose = require("mongoose");
const { clearKey } = require("../services/cache");
const Book = mongoose.model("Book");

module.exports = (app) => {
  app.get("/api/books", async (req, res) => {
    let books;
    if (req.query.author) {
      books = await Book.find({ author: req.query.author }).cache();
    } else {
      books = await Book.find().cache({
        time: 10,
      });
    }

    res.send(books);
  });

  app.post("/api/books", async (req, res) => {
    const { title, content, author } = req.body;

    const book = new Book({
      title,
      content,
      author,
    });

    try {
      await book.save();
      clearKey(Book.collection.collectionName);
      res.send(book);
    } catch (err) {
      res.send(400, err);
    }
  });
};
