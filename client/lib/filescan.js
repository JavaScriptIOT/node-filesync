#!/usr/bin/env node
(function () {
  "use strict";

  require('noop');

  String.prototype.reverse = function () {
    return this.split("").reverse().join("");
  }

  var mime = require('mime'),
    fs = require('fs'),
    qmd5 = require('qmd5'),
    path = require('path'),
    walk = require('walk'),
    crypto = require('crypto'),
    scannerDb = require('./scanner-sqlite3'),
    nodate = new Date(-9999999999999999);

  function create(options, cb) {
    var results = [],
      lastUpdate,
      fullscan = options.fullscan || true,
      updateFile = './lastupdate.json',
      blacklist = [/cache/i],
      max_packet_size = 1024 * 1024 * 2,
      curdate = new Date().valueOf(),
      lastBatch = 0;

    function handleDirectories(pathname, stats, next) {
      var i = 0,
        j,
        isblack,
        name;

      while(i < stats.length) {
        name = stats[i].name;
        isblack = false;
        for (j = 0; j < blacklist.length; j += 1) {
          if (blacklist[j].test(name)) {
            stats.splice(i, 1); // effectual increment
            isblack = true;
            break;
          }
        }
        if (!isblack) {
          i += 1; // increment if not decremented above
        }
      }

      next();
    }

    function createFile(pathname, stat) {
      var newstat = {};

      newstat.path = path.join(pathname, stat.name);

      newstat.mode = stat.mode;
      newstat.uid = stat.uid;
      newstat.gid = stat.gid;
      newstat.size = stat.size;
      newstat.mtime = stat.mtime.valueOf();
      newstat.name = stat.name;

      newstat.ext = path.extname(newstat.name).substring(1);
      newstat.rpath = pathname.reverse();
      newstat.basename = path.basename(newstat.name, '.' + newstat.ext);
      newstat.type = mime.lookup(newstat.ext);

      newstat.qmd5 = qmd5(newstat);

      return newstat;
    }

    function handleFile(pathname, stat, next) {
      var newstat;

      if (!fullscan && stat.mtime <= lastUpdate) {
        return next();
      }

      newstat = createFile(pathname, stat);
      newstat.updated_on = curdate;

      results.push(newstat);

      if (!(results.length % 1000)) {
        console.log(results.length.toString() + ' ' + newstat.path);
        scannerDb.insert(results.slice(results.length - 1000, results.length), function (err) {
          if (err) {
            console.log(err);
          }
          lastBatch = results.length;
          console.log('Saved 1k batch in db');
          next();
        });
      } else {
        next();
      }
    }

    function handleEnd() {
      if (!results.length) {
        return cb(null, results);
      }

      var batch = results.slice(lastBatch, results.length);

      scannerDb.insert(batch, function (err) {
        cb(err, results);
      });
    }


    fs.readFile(updateFile, function (err, data) {
      var lastUpdate, walker;
      if (data) {
        try {
          lastUpdate = new Date(JSON.parse(data).lastUpdate);
        } catch (e) {}
      }
      if (!lastUpdate) {
        lastUpdate = nodate;
        fullscan = true;
      }

      options.start = path.resolve(options.start);

      console.log(lastUpdate + ' ' + options.start);

      walker = walk(options.start),
      walker.on('directories', handleDirectories);
      walker.on('file', handleFile);
      walker.on('end', handleEnd);
    });
  }

  module.exports = create;
}());
