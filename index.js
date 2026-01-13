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
    const shelfCollection = bookWormDB.collection('shelves');

    // ==========================================
    // 1. User Management
    // ==========================================
    app.get('/users', async (req, res) => {
      const role = req.query.role;
      let query = {};
      if (role && role !== 'all') query.role = role;
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser)
        return res.send({ message: 'User exists', insertedId: null });

      const newUser = {
        ...user,
        role: 'user',
        status: 'active',
        joined: new Date(),
        annualGoal: 0,
        booksReadThisYear: 0,
        createdAt: new Date(),
      };
      res.send(await usersCollection.insertOne(newUser));
    });

    app.patch('/users/role/:id', async (req, res) => {
      const filter = { _id: new ObjectId(req.params.id) };
      res.send(
        await usersCollection.updateOne(filter, {
          $set: { role: req.body.role },
        })
      );
    });

    app.patch('/users/status/:id', async (req, res) => {
      const filter = { _id: new ObjectId(req.params.id) };
      res.send(
        await usersCollection.updateOne(filter, {
          $set: { status: req.body.status },
        })
      );
    });

    app.patch('/users/goal/:email', async (req, res) => {
      const filter = { email: req.params.email };
      res.send(
        await usersCollection.updateOne(filter, {
          $set: { annualGoal: parseInt(req.body.goal) },
        })
      );
    });

    // ==========================================
    // 2. Book Management
    // ==========================================
    app.post('/books', async (req, res) => {
      const book = {
        ...req.body,
        createdAt: new Date(),
        shelvedCount: 0,
        averageRating: 0,
        totalReviews: 0,
      };
      res.send(await booksCollection.insertOne(book));
    });

    app.get('/books', async (req, res) => {
      const { search, genre, sort, minRating } = req.query;
      let query = {};
      if (search)
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { author: { $regex: search, $options: 'i' } },
        ];
      if (genre) query.genre = genre;
      if (minRating) query.averageRating = { $gte: parseFloat(minRating) };

      let sortObj = {};
      if (sort === 'rating') sortObj = { averageRating: -1 };
      else if (sort === 'mostShelved') sortObj = { shelvedCount: -1 };
      else sortObj = { createdAt: -1 };

      res.send(await booksCollection.find(query).sort(sortObj).toArray());
    });

    app.get('/books/:id', async (req, res) => {
      res.send(
        await booksCollection.findOne({ _id: new ObjectId(req.params.id) })
      );
    });

    app.patch('/books/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = { ...req.body };
      delete updatedData._id;
      res.send(
        await booksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        )
      );
    });

    app.delete('/books/:id', async (req, res) => {
      res.send(
        await booksCollection.deleteOne({ _id: new ObjectId(req.params.id) })
      );
    });

    // ==========================================
    // 3. Genre Management (Full CRUD)
    // ==========================================
    app.get('/genres', async (req, res) => {
      res.send(await genresCollection.find().toArray());
    });

    app.post('/genres', async (req, res) => {
      res.send(await genresCollection.insertOne(req.body));
    });

    app.patch('/genres/:id', async (req, res) => {
      const id = req.params.id;
      const update = { ...req.body };
      delete update._id;
      res.send(
        await genresCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: update }
        )
      );
    });

    app.delete('/genres/:id', async (req, res) => {
      res.send(
        await genresCollection.deleteOne({ _id: new ObjectId(req.params.id) })
      );
    });

    // ==========================================
    // 4. Reading Tracker & Recommendations
    // ==========================================
    app.patch('/users/shelf', async (req, res) => {
      const { email, bookId, shelfType, progress, bookData } = req.body;
      const query = { userEmail: email, bookId: bookId };

      const updateDoc = {
        $set: {
          userEmail: email,
          bookId,
          shelfType,
          progress: progress || 0,
          bookTitle: bookData.title,
          cover: bookData.cover,
          genre: bookData.genre,
          author: bookData.author,
          updatedAt: new Date(),
        },
      };

      const result = await shelfCollection.updateOne(query, updateDoc, {
        upsert: true,
      });

      // Update Books Count & User Stats if book is marked as "Read"
      if (shelfType === 'read') {
        await usersCollection.updateOne(
          { email },
          { $inc: { booksReadThisYear: 1 } }
        );
      }

      if (result.upsertedCount > 0) {
        await booksCollection.updateOne(
          { _id: new ObjectId(bookId) },
          { $inc: { shelvedCount: 1 } }
        );
      }
      res.send(result);
    });

    app.get('/my-library/:email', async (req, res) => {
      res.send(
        await shelfCollection.find({ userEmail: req.params.email }).toArray()
      );
    });

    app.get('/recommendations/:email', async (req, res) => {
      const email = req.params.email;
      const userRead = await shelfCollection
        .find({ userEmail: email, shelfType: 'read' })
        .toArray();
      const readIds = userRead.map(b => new ObjectId(b.bookId));

      let query = { _id: { $nin: readIds } };
      if (userRead.length >= 3) {
        const favGenres = [...new Set(userRead.map(b => b.genre))];
        query.genre = { $in: favGenres };
      }

      const result = await booksCollection
        .find(query)
        .sort({ averageRating: -1 })
        .limit(15)
        .toArray();
      res.send(result);
    });

    // ==========================================
    // 5. Review Management (with Avg Rating Logic)
    // ==========================================
    app.post('/reviews', async (req, res) => {
      res.send(
        await reviewsCollection.insertOne({
          ...req.body,
          status: 'pending',
          createdAt: new Date(),
        })
      );
    });

    app.get('/reviews/admin', async (req, res) => {
      res.send(
        await reviewsCollection.find().sort({ createdAt: -1 }).toArray()
      );
    });

    app.patch('/reviews/approve/:id', async (req, res) => {
      const id = req.params.id;
      const review = await reviewsCollection.findOne({ _id: new ObjectId(id) });

      await reviewsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'approved' } }
      );

      // Recalculate Average Rating for the Book
      const allReviews = await reviewsCollection
        .find({ bookId: review.bookId, status: 'approved' })
        .toArray();
      const avg =
        allReviews.reduce((acc, r) => acc + r.rating, 0) / allReviews.length;

      await booksCollection.updateOne(
        { _id: new ObjectId(review.bookId) },
        {
          $set: {
            averageRating: parseFloat(avg.toFixed(1)),
            totalReviews: allReviews.length,
          },
        }
      );
      res.send({ success: true });
    });

    app.delete('/reviews/:id', async (req, res) => {
      res.send(
        await reviewsCollection.deleteOne({ _id: new ObjectId(req.params.id) })
      );
    });

    // ==========================================
    // 6. Stats & Charts
    // ==========================================
    app.get('/admin-stats', async (req, res) => {
      const totalBooks = await booksCollection.estimatedDocumentCount();
      const totalUsers = await usersCollection.estimatedDocumentCount();
      const pendingReviews = await reviewsCollection.countDocuments({
        status: 'pending',
      });
      const genreStats = await booksCollection
        .aggregate([{ $group: { _id: '$genre', count: { $sum: 1 } } }])
        .toArray();
      res.send({ totalBooks, totalUsers, pendingReviews, genreStats });
    });

    app.get('/user-stats/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      const shelves = await shelfCollection
        .find({ userEmail: email })
        .toArray();

      const genreData = await shelfCollection
        .aggregate([
          { $match: { userEmail: email } },
          { $group: { _id: '$genre', value: { $sum: 1 } } },
        ])
        .toArray();

      res.send({
        annualGoal: user?.annualGoal || 0,
        booksRead: user?.booksReadThisYear || 0,
        currentlyReading: shelves.filter(s => s.shelfType === 'reading').length,
        genreData, // For Pie Chart
      });
    });

    // ==========================================
    // 7. Tutorials
    // ==========================================
    app.get('/tutorials', async (req, res) => {
      res.send(await tutorialsCollection.find().sort({ _id: -1 }).toArray());
    });

    app.post('/tutorials', async (req, res) => {
      res.send(
        await tutorialsCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        })
      );
    });

    app.delete('/tutorials/:id', async (req, res) => {
      res.send(
        await tutorialsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        })
      );
    });
  } finally {
    // Keep connection alive
  }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('BookWorm Server is Flying! 🚀'));
app.listen(port, () => console.log(`Server running on port ${port}`));
