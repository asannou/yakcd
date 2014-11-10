// ==UserScript==
// @name        yakcd
// @namespace   asannou
// @description Yet Another Kindle Cloud Downloader
// @include     https://read.amazon.com/
// @include     https://read.amazon.co.jp/
// @grant       none
// @run-at      document-end
// @license     MIT License
// ==/UserScript==

(function(callback) {
  if (typeof jQuery == "undefined") {
    var script = document.createElement("script");
    script.setAttribute("src", "https://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js");
    script.addEventListener("load", function() {
      var script = document.createElement("script");
      script.textContent = "(" + callback.toString() + ")(jQuery.noConflict(true));";
      document.body.appendChild(script);
    }, false);
    document.body.appendChild(script);
  } else {
    callback($);
  }
})(function($) {

var Indicator = (function() {
  var originalTitle = document.title;
  var value = 0;
  var maximum = 1;
  var getDialog = function() {
    var iframeWindow = $("#KindleLibraryIFrame").get(0).contentWindow;
    return iframeWindow.KindleLibraryProgressDialog;
  };
  var findProgressMessage = function() {
    var iframeDocument = $("#KindleLibraryIFrame").contents();
    return iframeDocument.find("#kindleLibrary_dialog_progressMessage");
  };
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
      getDialog().updateValue(percent);
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
      getDialog().open(function() {
        location.reload();
      });
      findProgressMessage().hide();
    },
    closeDialog: function() {
      findProgressMessage().show();
      getDialog().close();
    }
  };
})();

var Zipper = (function() {
  var javascript = (function() {
    importScripts("https://asannou.github.io/yakcd/jszip/dist/jszip.min.js");
    var zip = new JSZip();
    this.addEventListener("message", function(e) {
      var id = e.data[0];
      var name = e.data[1];
      var r = zip[name].apply(zip, e.data[2]);
      this.postMessage([id, r instanceof JSZip ? null : r]);
    });
  })
  .toString()
  .match(/{([\d\D]*)}/)[1];
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

var getFileSaver = function() {
  if (typeof saveAs == "undefined") {
    return $.getScript(
      "https://asannou.github.io/yakcd/jszip/vendor/FileSaver.js"
    );
  } else {
    return $.Deferred().resolve();
  }
};

var Yakcd = function(asin) {

var serviceClient = KindleModuleManager
.getModuleSync(KindleModuleManager.SERVICE_CLIENT);

return $.Deferred().resolve()
.pipe(function() {
  Indicator.display();
  return Retriable(function() {
    return serviceClient.startReading({
      asin: asin,
      clientVersion: KindleVersion.getVersionNumber()
    });
  });
})
.pipe(function(book) {
  return Retriable(function() {
    return $.ajax({
      url: book.manifestUrl,
      dataType: "jsonp",
      jsonp: false,
      jsonpCallback: "loadManifest",
      cache: true,
      timeout: 30000
    });
  })
  .pipe(function(manifest) {
    return $.Deferred().resolve(book, manifest);
  });
})
.pipe(function(book, manifest) {
  var ids = $.map(manifest.resourceManifest, function(m, i) {
    var type = m.type.split("/")[0];
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
    d = d
    .pipe(function() {
      return Retriable(function() {
        return serviceClient.getFileUrl({
          asin: asin,
          contentVersion: book.contentVersion,
          formatVersion: book.formatVersion,
          kindleSessionId: book.kindleSessionId,
          resourceIds: ids
        });
      });
    })
    .pipe(function(url) {
      return $.when.apply($, $.map(url.resourceUrls, function(u) {
        return Retriable(function() {
          return $.ajax({
            url: u.signedUrl,
            dataType: "jsonp",
            jsonp: false,
            jsonpCallback: "loadResource" + u.id,
            cache: true,
            timeout: 30000
          });
        })
        .pipe(function(resource) {
          var id = ("000" + resource.metadata.id).substr(-4);
          var type = resource.metadata.type.split("/")[1];
          var data = resource.data.split(",")[1];
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
  return d;
})
.pipe(getFileSaver)
.pipe(function() {
  return Zipper.generate({ type: "blob" });
})
.done(function(content) {
  saveAs(content, asin + ".zip");
  Indicator.clear();
});

};

var YakcdOffline = function(asin) {

var bookInfoDB = KindleModuleManager
.getModuleSync(KindleModuleManager.DB_CLIENT)
.getBookDb()
.BookInfoDB(asin);

return $.Deferred().resolve()
.pipe(function() {
  Indicator.display();
  return bookInfoDB.getResourceIds();
})
.pipe(function(ids) {
  return bookInfoDB.getResources(ids);
})
.pipe(function(resources) {
  resources = $.map(resources, function(r) {
    var type = r ? r.metadata.type.split("/") : [];
    if (type[0] == "image") {
      var id = ("000" + r.metadata.id).substr(-4);
      r.file = "resource" + id + "." + type[1];
      r.data = r.data.split(",")[1];
      return r;
    } else {
      return null;
    }
  });
  Indicator.setMaximum(resources.length);
  var d = $.Deferred().resolve();
  $.each(resources, function(i, r) {
    d = d
    .pipe(function() {
      return Zipper.file(
        r.file,
        r.data,
        { base64: true }
      ).pipe(function() {
        Indicator.incrementAndDisplay();
        return $.Deferred().resolve();
      });
    });
  });
  return d;
})
.pipe(getFileSaver)
.pipe(function() {
  return Zipper.generate({ type: "blob" });
})
.done(function(content) {
  saveAs(content, asin + ".zip");
  Indicator.clear();
});

};

var appendCssTo = function(head) {
  $("<link/>")
  .attr({
    rel: "stylesheet",
    type: "text/css",
    href: "https://asannou.github.io/yakcd/yakcd.css"
  })
  .appendTo(head);
};

var appendButtonTo = function(container) {
  var asin = container.attr("id");
  var bookImage = container.find(".book_image");
  var button = $("<div/>")
  .appendTo(container)
  .attr("class", "yakcdButton")
  .css({
    position: "absolute",
    left: "70%",
    top: "-6px"
  });
  if (
    container.hasClass("book_is_cached") ||
    container.hasClass("book_is_pinned")
  ) {
    button
    .append($("<div/>").attr("class", "cloudDown"))
    .append($("<div/>").attr("class", "cloudDownArrow offline"))
    .click(function() { YakcdOffline(asin); });
  } else {
    button
    .append($("<div/>").attr("class", "cloudDown"))
    .append($("<div/>").attr("class", "cloudDownArrow"))
    .click(function() { Yakcd(asin); });
  }
};

$.Deferred().resolve()
.pipe(function() {
  var d = $.Deferred();
  var iframe = $("#KindleLibraryIFrame");
  if (iframe.length) {
    d.resolve(iframe);
  } else {
    new MutationObserver(function(mutations) {
      this.disconnect();
      var iframeWindow = mutations[0].addedNodes[0];
      d.resolve($(iframeWindow));
    })
    .observe(
      $("#KindleLibraryContainer")[0],
      { childList: true }
    );
  }
  return d;
})
.pipe(function(iframe) {
  var d = $.Deferred();
  var iframeDocument = iframe.contents();
  if (iframeDocument.find("#titles_inner_wrapper").length) {
    d.resolve(iframeDocument);
  } else {
    iframe.on("load", function() {
      d.resolve(iframe.contents());
    });
  }
  return d;
})
.done(function(iframeDocument) {
  appendCssTo(iframeDocument.find("head"));
  new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      $.makeArray(mutation.addedNodes).forEach(function(div) {
        appendButtonTo($(div));
      });
    });
  })
  .observe(
    iframeDocument.find("#titles_inner_wrapper")[0],
    { childList: true }
  );
  iframeDocument
  .find(".book_container")
  .each(function() {
    appendButtonTo($(this));
  });
});

});

