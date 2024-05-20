var express = require("express");
var router = express.Router();
var multer = require("multer");
// var users = require('./users');
var songmodel = require("../models/songsModel");
var playlistmodel = require("../models/playlistModel");
var passport = require("passport");
var mongoose = require("mongoose");
const { Readable } = require("stream");
const crypto = require("crypto");

var id3 = require("node-id3");
var localStrategy = require("passport-local");
const { futimesSync } = require("fs");
const userModel = require("./users");
passport.use(new localStrategy(userModel.authenticate()));

mongoose
  .connect("mongodb://0.0.0.0/spotify-N")
  .then(() => {
    console.log("connected to database");
  })
  .catch((err) => {
    console.log(err);
  });

router.get("/playlist/:playlistid", async (req, res) => {
  const currentuser = await userModel.findOne({
    username: req.session.passport.user,
  });
  var nowplaylist = await playlistmodel
    .findOne({
      _id: req.params.playlistid,
    })
    .populate("songs")
    .populate({
      path: "songs",
      populate: {
        path: "_id",
        model: "song",
      },
    });
  var allplaylist = await playlistmodel.find();

  res.render("playlist", { currentuser, allplaylist, nowplaylist });
});

router.get("/liked-songs", async (req, res) => {
  const currentuser = await userModel
    .findOne({
      username: req.session.passport.user,
    })
    .populate("liked")
    .populate({
      path: "liked",
      populate: {
        path: "_id",
        model: "song",
      },
    });
  var allplaylist = await playlistmodel.find();
  res.render("liked", { currentuser, allplaylist });
});

router.get("/stream/:musicName", async (req, res, next) => {
  var currentSong = await songmodel.findOne({
    fileName: req.params.musicName,
  });

  const stream = gfsBucket.openDownloadStreamByName(req.params.musicName);

  res.set("Content-Type", "audio/mpeg");
  res.set("Content-Length", currentSong.size + 1);
  res.set(
    "Content-Range",
    `bytes 0-${currentSong.size - 1}/${currentSong.size}`
  );
  res.set("Content-Ranges", "bytes");
  res.status(206);

  stream.pipe(res);
});

/* GET home page. */
router.get("/", isLoggedIn, async function (req, res, next) {
  const currentuser = await userModel
    .findOne({
      _id: req.user._id,
    })
    .populate("playlist")
    .populate({
      path: "playlist",
      populate: {
        path: "songs",
        model: "song",
      },
    });
  var allplaylist = await playlistmodel.find();
  res.render("index", { currentuser, allplaylist });
});

const conn = mongoose.connection;

var gfsBucket, gfsBucketPoster;
conn.once("open", () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: "audio",
  });
  gfsBucketPoster = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: "poster",
  });
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post(
  "/uploadMusic",
  isLoggedIn,
  isAdmin,
  upload.array("song"),
  async (req, res, next) => {
    await Promise.all(
      req.files.map(async (file) => {
        const randomName = crypto.randomBytes(20).toString("hex");
        const songdata = id3.read(file.buffer);
        console.log(songdata);
        Readable.from(file.buffer).pipe(gfsBucket.openUploadStream(randomName));
        Readable.from(songdata.image.imageBuffer).pipe(
          gfsBucketPoster.openUploadStream(randomName + "poster")
        );

        await songmodel.create({
          title: songdata.title,
          artist: songdata.artist,
          album: songdata.album,
          size: file.size,
          poster: randomName + "poster",
          fileName: randomName,
        });
      })
    );
    res.send("uploaded");
  }
);

router.get("/register", function (req, res, next) {
  res.render("auth");
});

router.get("/search", function (req, res, next) {
  res.render("search");
});

router.post("/search", async function (req, res, next) {
  var seachedMusic = await songmodel.find({
    title: { $regex: req.body.search },
  });

  res.json({
    songs: seachedMusic,
  });
});

router.get("/login", function (req, res, next) {
  res.render("auth");
});

router.get("/uploadmusic", isLoggedIn, isAdmin, function (req, res, next) {
  res.render("uploadMusic");
});

router.get("/poster/:postername", function (req, res, next) {
  gfsBucketPoster.openDownloadStreamByName(req.params.postername).pipe(res);
});

router.get("/like/:songid", async function (req, res, next) {
  var currentsong = await songmodel.findOne({
    _id: req.params.songid,
  });
  var currentuser = await userModel.findOne({
    username: req.session.passport.user,
  });

  var songalreadyliked = await currentuser.liked.includes(currentsong._id);

  if (songalreadyliked) {
    currentsong.likes.pull(currentuser._id);
    currentuser.liked.pull(currentsong._id);
  } else {
    currentsong.likes.push(currentuser._id);
    currentuser.liked.push(currentsong._id);
  }

  await currentsong.save();
  await currentuser.save();

  res.redirect("back");
});

router.get("/add/:playlistid/:songid", async function (req, res, next) {
  var currentsong = await songmodel.findOne({
    _id: req.params.songid,
  });
  var playlist = await playlistmodel.findOne({ _id: req.params.playlistid });
  playlist.songs.push(currentsong._id);
  playlist.save();

  res.redirect("back");
});

router.get("/remove/:songid/:playlistid", async function (req, res, next) {
  var currentsong = await songmodel.findOne({
    _id: req.params.songid,
  });
  var playlist = await playlistmodel.findOne({ _id: req.params.playlistid });
  playlist.songs.pull(currentsong._id);
  playlist.save();
  res.send(currentsong, playlist);

  // res.redirect('back')
});

router.post("/createplaylist", async (req, res, next) => {
  var currentuser = await userModel.findOne({
    username: req.session.passport.user,
  });

  await playlistmodel.create({
    name: req.body.name,
    owner: currentuser,
    poster: req.body.poster,
  });
  res.redirect("back");
});

//---------------------------------------------------------------------

// registering a user

router.post("/register", function (req, res, next) {
  var newUser = {
    username: req.body.username,
    email: req.body.email,
  };
  userModel
    .register(newUser, req.body.password)
    .then(function (u) {
      passport.authenticate("local")(req, res, async function () {
        const songs = await songmodel.find();
        const defaultPlayList = await playlistmodel.create({
          name: "default",
          owner: req.user._id,
          songs: songs.map((song) => song._id),
        });

        const newUser = await userModel.findOne({
          _id: req.user._id,
        });

        newUser.playlist.push(defaultPlayList._id);
        await newUser.save();

        res.redirect("/");
      });
    })
    .catch(function (e) {
      res.send(e);
    });
});

// login a user

router.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

//logout a user

router.get("/logout", function (req, res, next) {
  req.logOut();
  res.redirect("/login");
});

// is logeed in middle ware

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else {
    res.redirect("/login");
  }
}

//-------------------------------------------------------------------
function isAdmin(req, res, next) {
  if (req.user.isAdmin === true) {
    return next();
  } else {
    res.redirect("/");
  }
}

module.exports = router;
