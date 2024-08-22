const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeServerAndDB = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server is running at 3000 port')
    })
  } catch (error) {
    console.log(error)
  }
}

initializeServerAndDB()

const authenticateJwtToken = async (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_TOKEN', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

const checkIsUserFollowing = async (username, tweetId) => {
  const getUserQuery = `SELECT * FROM User WHERE username='${username}';`
  const user = await db.get(getUserQuery)

  const getFollowingUsersQuery = `SELECT Follower.following_user_id
                                   FROM Follower 
                                   WHERE Follower.follower_user_id=${user.user_id}; `

  const followingUsersList = await db.all(getFollowingUsersQuery)

  const getTweetUserIdQuery = `SELECT * FROM Tweet WHERE tweet_id=${tweetId};`
  const tweetUserId = await db.get(getTweetUserIdQuery)

  let isUserFollowing = false

  for (let followingUser of followingUsersList) {
    if (followingUser.following_user_id === tweetUserId.user_id) {
      isUserFollowing = true
      return isUserFollowing
    }
  }
  return isUserFollowing
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = `SELECT * FROM User WHERE username='${username}'; `
  const dbUser = await db.get(getUserQuery)
  if (dbUser === undefined) {
    const passwordLength = password.length
    if (passwordLength < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const postUserQuery = `Insert into User (name ,username,password,gender) values('${name}','${username}','${hashedPassword}','${gender}')`
      await db.run(postUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserQuery = `SELECT * FROM User WHERE username='${username}'; `
  const dbUser = await db.get(getUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get(
  '/user/tweets/feed',
  authenticateJwtToken,
  async (request, response) => {
    const username = request.username
    const getUserQuery = `SELECT * FROM User WHERE username='${username}'`
    const user = await db.get(getUserQuery)
    const getTweetsQuery = `SELECT * 
                 FROM Tweet
                 INNER JOIN Follower 
                 ON Follower.following_user_id=Tweet.user_id
                 INNER JOIN User 
                 ON Tweet.user_id=User.user_id
                 WHERE Follower.follower_user_id=${user.user_id}
                 ORDER BY date_time DESC 
                 LIMIT 4;`
    const tweetsList = await db.all(getTweetsQuery)
    response.send(
      tweetsList.map(userTweet => ({
        username: userTweet.name,
        tweet: userTweet.tweet,
        dateTime: userTweet.date_time,
      })),
    )
  },
)

app.get('/user/following', authenticateJwtToken, async (request, response) => {
  const username = request.username
  const getUserQuery = `SELECT * FROM User WHERE username='${username}';`
  const user = await db.get(getUserQuery)

  const getFollowingUsersQuery = `SELECT * 
                        FROM Follower 
                        INNER JOIN User
                        ON Follower.following_user_id=User.user_id
                        WHERE Follower.follower_user_id=${user.user_id}; `

  const followingUsersList = await db.all(getFollowingUsersQuery)
  response.send(
    followingUsersList.map(followingUser => ({
      name: followingUser.name,
    })),
  )
})

app.get('/user/followers', authenticateJwtToken, async (request, response) => {
  const username = request.username
  const getUserQuery = `SELECT * FROM User WHERE username='${username}';`
  const user = await db.get(getUserQuery)

  const getFollowersQuery = `SELECT *
                          FROM Follower
                          INNER JOIN User
                          ON Follower.follower_user_id=User.user_id
                          WHERE Follower.following_user_id=${user.user_id};`
  const followersList = await db.all(getFollowersQuery)
  response.send(
    followersList.map(follower => ({
      name: follower.name,
    })),
  )
})

app.get('/tweets/:tweetId', authenticateJwtToken, async (request, response) => {
  const username = request.username
  const {tweetId} = request.params

  const isUserFollowing = await checkIsUserFollowing(username, tweetId)

  if (isUserFollowing) {
    const getTweetQuery = `SELECT tweet, date_time  FROM Tweet WHERE tweet_id=${tweetId}; `
    const tweet = await db.get(getTweetQuery)

    const getLikesCountQuery = `SELECT COUNT(like_id) AS likesCount FROM Like WHERE tweet_id=${tweetId};`
    const likesCount = await db.all(getLikesCountQuery)

    const getRepliesCountQuery = `SELECT COUNT(reply_id) AS repliesCount FROM Reply WHERE tweet_id=${tweetId};`
    const repliesCount = await db.all(getRepliesCountQuery)

    response.send({
      tweet: tweet.tweet,
      likes: likesCount[0].likesCount,
      replies: repliesCount[0].repliesCount,
      dateTime: tweet.date_time,
    })
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes',
  authenticateJwtToken,
  async (request, response) => {
    const username = request.username
    const {tweetId} = request.params

    const isUserFollowing = await checkIsUserFollowing(username, tweetId)

    if (isUserFollowing) {
      const getLikedUsersQuery = `SELECT DISTINCT User.username 
                              FROM Like
                              INNER JOIN User 
                              ON Like.user_id = User.user_id 
                              WHERE Like.tweet_id=${tweetId};`
      const likedUsersList = await db.all(getLikedUsersQuery)
      const likedUsers = []
      likedUsersList.map(user => likedUsers.push(user.username))
      response.send({
        likes: likedUsers,
      })
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies',
  authenticateJwtToken,
  async (request, response) => {
    const username = request.username
    const {tweetId} = request.params

    const isUserFollowing = await checkIsUserFollowing(username, tweetId)

    if (isUserFollowing) {
      const getTweetRepliesQuery = `SELECT User.name ,
                                    Reply.reply As reply
                              FROM Reply
                              INNER JOIN User 
                              ON Reply.user_id = User.user_id 
                              WHERE Reply.tweet_id=${tweetId};`
      const repliesList = await db.all(getTweetRepliesQuery)

      response.status(200)
      response.send({
        replies: repliesList,
      })
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets', authenticateJwtToken, async (request, response) => {
  const username = request.username
  const getUserQuery = `SELECT * FROM User WHERE username='${username}';`
  const user = await db.get(getUserQuery)

  const getTweetsQuery = `SELECT 
  tweet,
   (SELECT count(*) FROM Like WHERE Like.tweet_id= tweet.tweet_id ) AS likes ,
   (SELECT count(*) FROM Reply WHERE Reply.tweet_id= tweet.tweet_id) AS replies ,
   date_time AS dateTime
FROM 
  Tweet 
WHERE 
  Tweet.user_id = ${user.user_id}`

  const tweets = await db.all(getTweetsQuery)

  response.send(tweets)
})

app.post('/user/tweets', authenticateJwtToken, async (request, response) => {
  const tweet = request.body.tweet
  const username = request.username

  const getUserQuery = `SELECT * FROM User WHERE username='${username}';`
  const user = await db.get(getUserQuery)

  const postTweetQuery = `INSERT INTO Tweet (tweet,user_id) VALUES ('${tweet}' ,${user.user_id});`
  await db.run(postTweetQuery)

  response.status(200)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId',
  authenticateJwtToken,
  async (request, response) => {
    const {tweetId} = request.params
    const username = request.username

    const getUserQuery = `SELECT * FROM User WHERE username='${username}';`
    const user = await db.get(getUserQuery)

    const getTweetUserQuery = `SELECT * FROM Tweet WHERE tweet_id=${tweetId};`
    const tweetUser = await db.get(getTweetUserQuery)

    if (tweetUser.user_id === user.user_id) {
      const deleteTweetQuery = `DELETE FROM Tweet WHERE tweet_id=${tweetId};`
      await db.run(deleteTweetQuery)

      response.status(200)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

module.exports = app
