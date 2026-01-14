const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- verifyAdmin middleware (No JWT version) ---
const verifyAdmin = async (req, res, next) => {
  const email = req.query.email;
  if (!email) {
    return res.status(401).send({ message: 'Unauthenticated Access' });
  }

  const query = { email: email };
  const user = await usersCollection.findOne(query);

  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'Forbidden Access' });
  }

  next();
};

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

    // Get all users or filter by role
    app.get('/users', async (req, res) => {
      const role = req.query.role;
      let query = {};
      if (role && role !== 'all') query.role = role;
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Get single user by email
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // Save or Initialize user on Login
    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
      }

      const result = await usersCollection.insertOne({
        ...user,
        role: 'user',
        status: 'active',
        booksReadThisYear: 0,
        annualGoal: 0,
        joined: new Date().toISOString(),
        createdAt: new Date(),
      });
      res.send(result);
    });

    // Update User Role
    app.patch('/users/role/:id', verifyAdmin, async (req, res) => {
      const filter = { _id: new ObjectId(req.params.id) };
      res.send(
        await usersCollection.updateOne(filter, {
          $set: { role: req.body.role },
        })
      );
    });

    // Update User Status (Active/Block)
    app.patch('/users/status/:id', verifyAdmin, async (req, res) => {
      const filter = { _id: new ObjectId(req.params.id) };
      res.send(
        await usersCollection.updateOne(filter, {
          $set: { status: req.body.status },
        })
      );
    });

    // Update Annual Reading Goal
    app.patch('/users/goal/:email', async (req, res) => {
      const filter = { email: req.params.email };
      res.send(
        await usersCollection.updateOne(filter, {
          $set: { annualGoal: parseInt(req.body.goal) },
        })
      );
    });

    // Update Profile Info
    app.patch('/users/update/:email', async (req, res) => {
      const { displayName, photoURL } = req.body;
      const filter = { email: req.params.email };
      const result = await usersCollection.updateOne(filter, {
        $set: { displayName, photoURL },
      });
      res.send(result);
    });

    // ==========================================
    // 2. Book Management
    // ==========================================

    // Add new book (Admin)
    app.post('/books', async (req, res) => {
      try {
        const book = {
          ...req.body,
          rating: parseFloat(req.body.rating) || 0,
          createdAt: new Date(),
          shelvedCount: 0,
          averageRating: 0,
          totalReviews: 0,
        };
        const result = await booksCollection.insertOne(book);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Error adding book', error });
      }
    });

    // Get books with Search, Multi-Genre, and Sort filters
    app.get('/books', async (req, res) => {
      try {
        const { search, genre, sort, minRating } = req.query;
        let query = {};

        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { author: { $regex: search, $options: 'i' } },
          ];
        }

        if (genre) {
          query.genre = { $in: genre.split(',') };
        }

        if (minRating) {
          query.rating = { $gte: parseFloat(minRating) };
        }

        let sortObj = { createdAt: -1 };
        if (sort === 'rating') sortObj = { rating: -1 };
        if (sort === 'mostShelved') sortObj = { shelvedCount: -1 };

        const result = await booksCollection
          .find(query)
          .sort(sortObj)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching books', error });
      }
    });

    // Get book details with approved reviews
    app.get('/books/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await booksCollection
          .aggregate([
            { $match: { _id: new ObjectId(id) } },
            {
              $lookup: {
                from: 'reviews',
                let: { bookIdStr: { $toString: '$_id' } },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$bookId', '$$bookIdStr'] },
                          { $eq: ['$status', 'approved'] },
                        ],
                      },
                    },
                  },
                  { $sort: { createdAt: -1 } },
                ],
                as: 'reviews',
              },
            },
          ])
          .toArray();

        if (result.length === 0)
          return res.status(404).send({ message: 'Book not found' });
        res.send(result[0]);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching book details', error });
      }
    });

    // Update existing book (Admin Only)
    app.patch('/books/:id', async (req, res) => {
      try {
        const id = req.params.id;

        // ১. ID ভ্যালিডেশন চেক (এরর হ্যান্ডলিং মজবুত করার জন্য)
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid Book ID format' });
        }

        const filter = { _id: new ObjectId(id) };
        const updatedBook = req.body;

        const updateDoc = {
          $set: {
            title: updatedBook.title,
            author: updatedBook.author,
            genre: updatedBook.genre,
            // ২. নাম্বার কনভার্সন ফ্রন্টএন্ড থেকে না আসলেও যেন সার্ভার ক্র্যাশ না করে
            rating: parseFloat(updatedBook.rating) || 0,
            totalPage: parseInt(updatedBook.totalPage) || 0,
            description: updatedBook.description,
            summary: updatedBook.summary,
            cover: updatedBook.cover,
            status: updatedBook.status,
            lastUpdated: new Date(),
          },
        };

        const result = await booksCollection.updateOne(filter, updateDoc);

        // ৩. আপডেট হয়েছে কি না তা চেক করা
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Book not found' });
        }

        res.send(result);
      } catch (error) {
        console.error('Update Error:', error); // সার্ভার লগে এরর দেখার জন্য
        res
          .status(500)
          .send({ message: 'Error updating book', error: error.message });
      }
    });

    // Delete Book and its dependencies
    app.delete('/books/:id', async (req, res) => {
      try {
        const id = req.params.id;
        await reviewsCollection.deleteMany({ bookId: id });
        await shelfCollection.deleteMany({ bookId: id });
        const result = await booksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Error deleting book', error });
      }
    });

    // Admin Dashboard Stats
    app.get('/admin-stats', verifyAdmin, async (req, res) => {
      try {
        const totalBooks = await booksCollection.estimatedDocumentCount();
        const totalUsers = await usersCollection.estimatedDocumentCount();
        const totalReviews = await reviewsCollection.countDocuments({
          status: 'approved',
        });
        const pendingReviews = await reviewsCollection.countDocuments({
          status: 'pending',
        });

        const genreStats = await booksCollection
          .aggregate([
            { $group: { _id: '$genre', count: { $sum: 1 } } },
            { $limit: 6 },
          ])
          .toArray();

        res.send({
          totalBooks,
          totalUsers,
          totalReviews,
          pendingReviews,
          genreStats,
        });
      } catch (error) {
        res.status(500).send({ message: 'Admin stats error', error });
      }
    });

    // ==========================================
    // 3. Reading Tracker (Library)
    // ==========================================

    // Add or Update book in User Shelf
    app.patch('/users/shelf', async (req, res) => {
      try {
        const { email, bookId, shelfType, progress, bookData } = req.body;
        const query = { userEmail: email, bookId: bookId };
        const existingEntry = await shelfCollection.findOne(query);

        const totalPageCount = parseInt(bookData?.totalPage || 0);
        const finalProgress =
          shelfType === 'read' ? totalPageCount : parseInt(progress || 0);

        const updateDoc = {
          $set: {
            userEmail: email,
            bookId,
            shelfType,
            progress: finalProgress,
            bookTitle: bookData?.title,
            cover: bookData?.cover,
            genre: bookData?.genre,
            author: bookData?.author,
            totalPage: totalPageCount,
            updatedAt: new Date(),
          },
        };

        const result = await shelfCollection.updateOne(query, updateDoc, {
          upsert: true,
        });

        // Increment shelvedCount if newly added
        if (result.upsertedCount > 0) {
          await booksCollection.updateOne(
            { _id: new ObjectId(bookId) },
            { $inc: { shelvedCount: 1 } }
          );
        }

        // Increment booksReadThisYear if status changed to 'read'
        if (
          shelfType === 'read' &&
          (!existingEntry || existingEntry.shelfType !== 'read')
        ) {
          await usersCollection.updateOne(
            { email },
            { $inc: { booksReadThisYear: 1 } }
          );
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Shelf update failed', error });
      }
    });

    // Update Progress from Library & Auto-complete
    app.patch('/library/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { progress } = req.body;
        const filter = { _id: new ObjectId(id) };
        const shelfItem = await shelfCollection.findOne(filter);

        if (!shelfItem)
          return res.status(404).send({ message: 'Book not found in library' });

        const updateDoc = {
          $set: {
            progress: parseInt(progress),
            updatedAt: new Date(),
          },
        };

        // If progress reaches total pages, change status to 'read' and update user stats
        if (
          parseInt(progress) >= shelfItem.totalPage &&
          shelfItem.shelfType !== 'read'
        ) {
          updateDoc.$set.shelfType = 'read';
          await usersCollection.updateOne(
            { email: shelfItem.userEmail },
            { $inc: { booksReadThisYear: 1 } }
          );
        }

        const result = await shelfCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Progress update failed', error });
      }
    });

    // Remove book from Library
    app.delete('/my-library/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const item = await shelfCollection.findOne({ _id: new ObjectId(id) });

        if (item) {
          // Decrement counters
          await booksCollection.updateOne(
            { _id: new ObjectId(item.bookId) },
            { $inc: { shelvedCount: -1 } }
          );
          if (item.shelfType === 'read') {
            await usersCollection.updateOne(
              { email: item.userEmail },
              { $inc: { booksReadThisYear: -1 } }
            );
          }
        }

        const result = await shelfCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: 'Failed to remove from library', error });
      }
    });

    // Get User Library
    app.get('/my-library/:email', async (req, res) => {
      const result = await shelfCollection
        .find({ userEmail: req.params.email })
        .sort({ updatedAt: -1 })
        .toArray();
      res.send(result);
    });

    // ==========================================
    // 4. Reviews & Stats
    // ==========================================

    // এডমিনের জন্য সব রিভিউ দেখা (ModerateReviews পেজের জন্য)
    app.get('/reviews/admin', verifyAdmin, async (req, res) => {
      try {
        // সব রিভিউ আনবে এবং নতুনগুলো আগে দেখাবে
        const result = await reviewsCollection
          .find()
          .sort({ lastUpdated: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching reviews', error });
      }
    });

    // নির্দিষ্ট বইয়ের জন্য রিভিউ দেখা (বইয়ের ডিটেইলস পেজের জন্য)
    app.get('/reviews/:bookId', async (req, res) => {
      const bookId = req.params.bookId;
      const result = await reviewsCollection
        .find({ bookId: bookId, status: 'approved' })
        .sort({ lastUpdated: -1 })
        .toArray();
      res.send(result);
    });

    // রিভিউ ডিলিট করা
    app.delete('/reviews/:id', verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Error deleting review', error });
      }
    });

    // Submit Review (Updated with auto-rating calculation)
    app.post('/reviews', async (req, res) => {
      const review = req.body;
      const query = {
        bookId: review.bookId,
        userEmail: review.userEmail,
      };

      const updateDoc = {
        $set: {
          userName: review.userName,
          userImage: review.userImage,
          rating: review.rating,
          comment: review.comment,
          date: review.date,
          status: 'approved',
          bookTitle: review.bookTitle,
          lastUpdated: new Date(),
        },
      };

      try {
        // ১. রিভিউ সেভ বা আপডেট করা
        const result = await reviewsCollection.updateOne(query, updateDoc, {
          upsert: true,
        });

        // ২. এই বইয়ের সব approved রিভিউর গড় রেটিং বের করা
        const allReviews = await reviewsCollection
          .find({ bookId: review.bookId, status: 'approved' })
          .toArray();

        const totalReviews = allReviews.length;
        const avg =
          allReviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews;

        // ৩. বইয়ের মেইন কালেকশনে রেটিং আপডেট করে দেওয়া
        await booksCollection.updateOne(
          { _id: new ObjectId(review.bookId) },
          {
            $set: {
              averageRating: parseFloat(avg.toFixed(1)),
              rating: parseFloat(avg.toFixed(1)), // ফিল্টারিং এর জন্য
              totalReviews: totalReviews,
            },
          }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Review update failed', error });
      }
    });

    // Approve Review & Update Book Rating
    app.patch('/reviews/approve/:id', verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const review = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!review)
          return res.status(404).send({ message: 'Review not found' });

        await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'approved' } }
        );

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
              rating: parseFloat(avg.toFixed(1)),
              totalReviews: allReviews.length,
            },
          }
        );

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ message: 'Approval failed', error });
      }
    });

    // User Dashboard Analytics
    app.get('/user-stats/:email', async (req, res) => {
      try {
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
          currentlyReading: shelves.filter(s => s.shelfType === 'reading')
            .length,
          genreData,
        });
      } catch (error) {
        res.status(500).send({ message: 'User stats failed', error });
      }
    });

    // ==========================================
    // 5. General APIs (Genres, Tutorials)
    // ==========================================
    app.get('/genres', async (req, res) =>
      res.send(await genresCollection.find().toArray())
    );
    app.get('/tutorials', async (req, res) =>
      res.send(await tutorialsCollection.find().sort({ _id: -1 }).toArray())
    );

    // ৬. Activity Feed (কমিউনিটি আপডেট)
    app.get('/activities', async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find()
          .sort({ lastUpdated: -1 })
          .limit(5)
          .toArray();

        // ফরম্যাট করা ডাটা পাঠানো যা ফ্রন্টএন্ডের সাথে মিলবে
        const activities = reviews.map(r => ({
          _id: r._id,
          userName: r.userName,
          userAvatar: r.userImage,
          actionText: `rated ${r.rating} stars to`,
          bookTitle: r.bookTitle,
          type: 'rate',
          createdAt: 'Just now',
        }));

        res.send(activities);
      } catch (error) {
        res.status(500).send({ message: 'Error fetching activities', error });
      }
    });
  } finally {
    // Keep client running
  }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('BookWorm Server is Flying! 🚀'));
app.listen(port, () => console.log(`Server running on port ${port}`));
