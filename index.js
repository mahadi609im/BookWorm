const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Database Connection ---
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4k43auc.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const bookWormDB = client.db('bookWorm');
    const usersCollection = bookWormDB.collection('users');
    const booksCollection = bookWormDB.collection('books');
    const genresCollection = bookWormDB.collection('genres');
    const reviewsCollection = bookWormDB.collection('reviews');
    const tutorialsCollection = bookWormDB.collection('tutorials');

    // --- 1. User APIs ---
    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) return res.send({ message: 'user already exists' });

      user.role = 'user'; // default role
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // --- 2. Book Management ---
    app.post('/books', async (req, res) => {
      const result = await booksCollection.insertOne(req.body);
      res.send(result);
    });

    app.get('/books', async (req, res) => {
      const { search, genre } = req.query;
      let query = {};
      if (search) query.title = { $regex: search, $options: 'i' };
      if (genre) query.genre = genre;

      const result = await booksCollection.find(query).toArray();
      res.send(result);
    });

    app.delete('/books/:id', async (req, res) => {
      const result = await booksCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });
  } finally {
    // client.close() kora jabe na jate connection thake
  }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('BookWorm Normal Server Running'));
app.listen(port, () => console.log(`Server on ${port}`));
