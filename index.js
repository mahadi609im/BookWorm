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

    // --- 1. User Management ---
    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) return res.send({ message: 'User already exists' });

      user.role = 'user';
      user.annualGoal = 0;
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users', async (req, res) => {
      res.send(await usersCollection.find().toArray());
    });

    // নির্দিষ্ট ইউজারের ডাটা এবং রোল পাওয়ার জন্য (Auth Context এ কাজে লাগবে)
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.patch('/users/role/:id', async (req, res) => {
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role } }
      );
      res.send(result);
    });

    // --- 2. Book Management (Admin & General) ---
    app.post('/books', async (req, res) => {
      const book = {
        ...req.body,
        createdAt: new Date(),
        shelvedCount: 0,
        averageRating: 0,
        totalReviews: 0,
      };
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    // Browse Books API with Advanced Search/Filters
    app.get('/books', async (req, res) => {
      const { search, genre, sort, minRating } = req.query;
      let query = {};

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { author: { $regex: search, $options: 'i' } },
        ];
      }
      if (genre) query.genre = genre;
      if (minRating) query.averageRating = { $gte: parseFloat(minRating) };

      let sortObj = {};
      if (sort === 'rating') sortObj = { averageRating: -1 };
      if (sort === 'mostShelved') sortObj = { shelvedCount: -1 };
      if (sort === 'newest') sortObj = { createdAt: -1 };

      const result = await booksCollection.find(query).sort(sortObj).toArray();
      res.send(result);
    });

    // Get Single Book Details (মিসিং ছিল)
    app.get('/books/:id', async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.patch('/books/:id', async (req, res) => {
      const id = req.params.id;
      const updatedBook = req.body;
      delete updatedBook._id;
      const result = await booksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedBook }
      );
      res.send(result);
    });

    app.delete('/books/:id', async (req, res) => {
      res.send(
        await booksCollection.deleteOne({ _id: new ObjectId(req.params.id) })
      );
    });

    // --- 3. Genre Management ---
    app.get('/genres', async (req, res) => {
      res.send(await genresCollection.find().toArray());
    });

    // --- 4. Reading Tracker & Recommendations ---

    // User Shelf Management (Update/Add)
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

      // বইয়ের shelvedCount বাড়ানো (যদি নতুন অ্যাড হয়)
      if (result.upsertedCount > 0) {
        await booksCollection.updateOne(
          { _id: new ObjectId(bookId) },
          { $inc: { shelvedCount: 1 } }
        );
      }
      res.send(result);
    });

    // ইউজারের নিজস্ব লাইব্রেরি পাওয়ার API
    app.get('/my-library/:email', async (req, res) => {
      const email = req.params.email;
      const result = await shelfCollection.find({ userEmail: email }).toArray();
      res.send(result);
    });

    // Personalized Recommendations (Logic based on Genre & Ratings)
    app.get('/recommendations/:email', async (req, res) => {
      const email = req.params.email;
      const userReadBooks = await shelfCollection
        .find({ userEmail: email, shelfType: 'read' })
        .toArray();

      let query = {};
      if (userReadBooks.length > 0) {
        const favoriteGenres = [...new Set(userReadBooks.map(b => b.genre))];
        query = {
          genre: { $in: favoriteGenres },
          _id: { $nin: userReadBooks.map(b => new ObjectId(b.bookId)) },
        };
      }

      // যদি পড়া বই কম থাকে, তবে হাই রেটিং বই রিকমেন্ড করবে
      const recommended = await booksCollection
        .find(query)
        .sort({ averageRating: -1 })
        .limit(15)
        .toArray();
      res.send(recommended);
    });

    // --- 5. Review Management ---
    app.post('/reviews', async (req, res) => {
      const review = { ...req.body, status: 'pending', createdAt: new Date() };
      res.send(await reviewsCollection.insertOne(review));
    });

    // নির্দিষ্ট বইয়ের সব এপ্রুভড রিভিউ (Book Details এর জন্য)
    app.get('/reviews/book/:bookId', async (req, res) => {
      const result = await reviewsCollection
        .find({
          bookId: req.params.bookId,
          status: 'approved',
        })
        .toArray();
      res.send(result);
    });

    app.patch('/reviews/approve/:id', async (req, res) => {
      const id = req.params.id;
      const review = await reviewsCollection.findOne({ _id: new ObjectId(id) });

      // এপ্রুভ করার সাথে সাথে মেইন বইয়ের এভারেজ রেটিং আপডেট করা (Bonus logic)
      const approvedResult = await reviewsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'approved' } }
      );

      // ক্যালকুলেট এভারেজ রেটিং (সিম্পল লজিক)
      const bookReviews = await reviewsCollection
        .find({ bookId: review.bookId, status: 'approved' })
        .toArray();
      const avgRating =
        bookReviews.reduce((sum, r) => sum + r.rating, 0) / bookReviews.length;

      await booksCollection.updateOne(
        { _id: new ObjectId(review.bookId) },
        {
          $set: {
            averageRating: parseFloat(avgRating.toFixed(1)),
            totalReviews: bookReviews.length,
          },
        }
      );

      res.send(approvedResult);
    });

    // --- 6. Admin & User Stats ---
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

    // User Dashboard Stats (মিসিং ছিল)
    app.get('/user-stats/:email', async (req, res) => {
      const email = req.params.email;
      const shelfData = await shelfCollection
        .find({ userEmail: email })
        .toArray();
      const readBooks = shelfData.filter(b => b.shelfType === 'read');
      const readingBooks = shelfData.filter(b => b.shelfType === 'reading');

      const totalPagesRead = readBooks.length * 300; // Estimated or you can take actual pages
      res.send({
        booksRead: readBooks.length,
        currentlyReading: readingBooks.length,
        totalPagesRead,
        shelfData,
      });
    });

    // --- 7. Tutorials ---
    app.get('/tutorials', async (req, res) => {
      res.send(await tutorialsCollection.find().toArray());
    });
  } finally {
    // client.close() - Keep connection open
  }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('BookWorm API Server Active'));
app.listen(port, () => console.log(`Running on port ${port}`));
