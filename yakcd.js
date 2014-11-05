/*
 * @title yakcd
 * @description Yet Another Kindle Cloud Downloader
 * @include https://read.amazon.com
 * @include https://read.amazon.co.jp
 * @license MIT License
 */

$.when(
  $.getScript("//asannou.github.io/yakcd/jszip/vendor/FileSaver.js")
).
done(function() {

var iframeWindow = $("#KindleLibraryIFrame").get(0).contentWindow;
var iframeDocument = $(iframeWindow.document);

var Indicator = function() {
  var originalTitle = document.title;
  var dialog = iframeWindow.KindleLibraryProgressDialog;
  var value = 0;
  var maximum = 1;
  return {
    setMaximum: function(m) {
      maximum = m;
    },
    increment: function() {
      value++;
    },
    display: function() {
      var percent = Math.round(value * 100 / maximum);
      document.title = "[" + percent + "%] " + originalTitle;
      if (!value) {
        this.openDialog();
      }
      dialog.updateValue(percent);
    },
    incrementAndDisplay: function() {
      this.increment();
      this.display();
    },
    clear: function() {
      value = 0;
      document.title = originalTitle;
      this.closeDialog();
    },
    openDialog: function() {
      dialog.open(function() {
        location.reload();
      });
      iframeDocument.find("#kindleLibrary_dialog_progressMessage").hide();
    },
    closeDialog: function() {
      iframeDocument.find("#kindleLibrary_dialog_progressMessage").show();
      dialog.close();
    }
  };
}();

var Zipper = (function() {
  var javascript = (function() {
    importScripts("https://asannou.github.io/yakcd/jszip/dist/jszip.min.js");
    var zip = new JSZip();
    self.addEventListener("message", function(e) {
      var id = e.data[0];
      var name = e.data[1];
      var r = zip[name].apply(zip, e.data[2]);
      self.postMessage([id, r instanceof JSZip ? null : r]);
    });
  }).
  toString().
  match(/{([\d\D]*)}/)[1];
  var blob = new Blob([ javascript ], { type: "text/javascript" });
  var blobURL = window.URL.createObjectURL(blob);
  var worker = new Worker(blobURL);
  var post = function(name) {
    return function() {
      var d = $.Deferred();
      var id = Math.random().toString(36).substr(2);
      var listener = function(e) {
        if (e.data[0] == id) {
          worker.removeEventListener("message", listener);
          return d.resolve(e.data[1]);
        }
      };
      worker.addEventListener("message", listener);
      worker.postMessage([id, name, $.makeArray(arguments)]);
      return d;
    };
  };
  return {
    file: post("file"),
    generate: post("generate")
  };
})();

var Retriable = function(dd) {
  var d = $.Deferred();
  (function n() {
    dd().pipe(d.resolve, function() {
      if (window.confirm("retry? " + this.url)) {
        n();
      } else {
        d.reject();
      }
    });
  })();
  return d;
};

var concurrency = (function() {
  var query = $("<a>", { href: $("script").last().attr("src") })[0].search;
  return query ? query.substr(1) : 6;
})();

var Yakcd = function(asin) {

var serviceClient = KindleModuleManager.
getModuleSync(KindleModuleManager.SERVICE_CLIENT);

return $.Deferred().resolve().
pipe(function() {
  Indicator.display();
  return Retriable(function() {
    return serviceClient.startReading({
      asin: asin,
      clientVersion: KindleVersion.getVersionNumber()
    });
  });
}).
pipe(function(book) {
  return Retriable(function() {
    return $.ajax({
      url: book["manifestUrl"],
      dataType: "jsonp",
      jsonp: false,
      jsonpCallback: "loadManifest",
      cache: true,
      timeout: 30000
    });
  }).
  pipe(function(manifest) {
    return $.Deferred().resolve(book, manifest);
  });
}).
pipe(function(book, manifest) {
  var ids = $.map(manifest["resourceManifest"], function(m, i) {
    var type = m["type"].split("/")[0];
    if (type == "image") {
      return i;
    } else {
      return null;
    }
  });
  Indicator.setMaximum(ids.length);
  var slicedIds = [];
  for (var i = 0; i < ids.length / concurrency; i++) {
    slicedIds.push(ids.slice(i * concurrency, (i + 1) * concurrency));
  }
  var d = $.Deferred().resolve();
  $.each(slicedIds, function(i, ids) {
    d = d.
    pipe(function() {
      return Retriable(function() {
        return serviceClient.getFileUrl({
          asin: asin,
          contentVersion: book["contentVersion"],
          formatVersion: book["formatVersion"],
          kindleSessionId: book["kindleSessionId"],
          resourceIds: ids
        });
      });
    }).
    pipe(function(url) {
      return $.when.apply($, $.map(url["resourceUrls"], function(u, i) {
        return Retriable(function() {
          return $.ajax({
            url: u["signedUrl"],
            dataType: "jsonp",
            jsonp: false,
            jsonpCallback: "loadResource" + u["id"],
            cache: true,
            timeout: 30000
          });
        }).
        pipe(function(resource) {
          var id = ("000" + resource["metadata"]["id"]).substr(-4);
          var type = resource["metadata"]["type"].split("/")[1];
          var data = resource["data"].split(",")[1];
          return Zipper.file(
            "resource" + id + "." + type,
            data,
            { base64: true }
          ).pipe(function() {
            Indicator.incrementAndDisplay();
            return $.Deferred().resolve();
          });
        });
      }));
    });
  });
  return d.pipe(function() {
    return Zipper.generate({ type: "blob" });
  });
}).
done(function(content) {
  saveAs(content, asin + ".zip");
  Indicator.clear();
});

};

var YakcdOffline = function(asin) {

var bookInfoDB = KindleModuleManager.
getModuleSync(KindleModuleManager.DB_CLIENT).
getBookDb().
BookInfoDB(asin);

return $.Deferred().resolve().
pipe(function() {
  Indicator.display();
  return bookInfoDB.getResourceIds();
}).
pipe(function(ids) {
  return bookInfoDB.getResources(ids);
}).
pipe(function(resources) {
  resources = $.map(resources, function(resource) {
    var type = resource ? resource["metadata"]["type"].split("/") : [];
    if (type[0] == "image") {
      var id = ("000" + resource["metadata"]["id"]).substr(-4);
      resource["file"] = "resource" + id + "." + type[1];
      resource["data"] = resource["data"].split(",")[1];
      return resource;
    } else {
      return null;
    }
  });
  Indicator.setMaximum(resources.length);
  var d = $.Deferred().resolve();
  $.each(resources, function(i, resource) {
    d = d.
    pipe(function() {
      return Zipper.file(
        resource["file"],
        resource["data"],
        { base64: true }
      ).pipe(function() {
        Indicator.incrementAndDisplay();
        return $.Deferred().resolve();
      });
    });
  });
  return d;
}).
pipe(function() {
  return Zipper.generate({ type: "blob" });
}).
done(function(content) {
  saveAs(content, asin + ".zip");
  Indicator.clear();
});

};

$("<link/>").
attr({
  rel: "stylesheet",
  type: "text/css",
  href: "//asannou.github.io/yakcd/yakcd.css"
}).
appendTo(iframeDocument.find("head"));

iframeDocument.
find(".book_container").
each(function(){
  var asin = $(this).attr("id");
  var bookImage = $(this).find(".book_image");
  offset = bookImage.offset();
  offset.left += bookImage.width() - 16;
  offset.top -= 16;
  var button = $("<div/>").
  appendTo($(this)).
  attr("class", "yakcdButton").
  css("position", "absolute").
  offset(offset);
  if (
    $(this).hasClass("book_is_cached") ||
    $(this).hasClass("book_is_pinned")
  ) {
    button.
    append($("<div/>").attr("class", "cloudDown")).
    append($("<div/>").attr("class", "cloudDownArrow offline")).
    click(function () { YakcdOffline(asin); });
  } else {
    button.
    append($("<div/>").attr("class", "cloudDown")).
    append($("<div/>").attr("class", "cloudDownArrow")).
    click(function () { Yakcd(asin); });
  }
});

});

