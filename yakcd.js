/*
 * @title yakcd
 * @description Yet Another Kindle Cloud Downloader
 * @include https://read.amazon.com
 * @include https://read.amazon.co.jp
 * @license MIT License
 */

$.when(
  $.getScript("//asannou.github.io/yakcd/jszip/dist/jszip.min.js"),
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

var Yakcd = function(asin) {

const CONCURRENCY = 6;

var serviceClient = KindleModuleManager.
getModuleSync(KindleModuleManager.SERVICE_CLIENT);

return $.Deferred().resolve().
pipe(function(content) {
  Indicator.display();
  return serviceClient.startReading({
    asin: asin,
    clientVersion: KindleVersion.getVersionNumber()
  });
}).
pipe(function(book) {
  return $.ajax({
    url: book["manifestUrl"],
    dataType: "jsonp",
    jsonp: false,
    jsonpCallback: "loadManifest",
    cache: true,
    timeout: 0
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
  for (var i = 0; i < ids.length / CONCURRENCY; i++) {
    slicedIds.push(ids.slice(i * CONCURRENCY, (i + 1) * CONCURRENCY));
  }
  var zip = new JSZip();
  var d = $.Deferred().resolve();
  $.each(slicedIds, function(i, ids) {
    d = d.
    pipe(function() {
      return serviceClient.getFileUrl({
        asin: asin,
        contentVersion: book["contentVersion"],
        formatVersion: book["formatVersion"],
        kindleSessionId: book["kindleSessionId"],
        resourceIds: ids
      });
    }).
    pipe(function(url) {
      return $.when.apply($, $.map(url["resourceUrls"], function(u, i) {
        return $.ajax({
          url: u["signedUrl"],
          dataType: "jsonp",
          jsonp: false,
          jsonpCallback: "loadResource" + u["id"],
          cache: true,
          timeout: 0
        }).
        success(function(resource) {
          var id = ("000" + resource["metadata"]["id"]).substr(-4);
          var type = resource["metadata"]["type"].split("/")[1];
          var data = resource["data"].split(",")[1];
          zip.file("resource" + id + "." + type, data, { base64: true });
          Indicator.incrementAndDisplay();
        });
      }));
    });
  });
  return d.pipe(function() {
    var content = zip.generate({ type: "blob" });
    return $.Deferred().resolve(content);
  });
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
  var bookImage = $(this).find(".book_image");
  offset = bookImage.offset();
  offset.left += bookImage.width() - 16;
  offset.top -= 16;
  $("<div/>").
  appendTo($(this)).
  attr("class", "yakcdButton").
  css("position", "absolute").
  offset(offset).
  click(function() {
    var asin = $(this).parent().attr("id");
    Yakcd(asin);
  }).
  append($("<div/>").attr("class", "cloudDown")).
  append($("<div/>").attr("class", "cloudDownArrow"));
});

});

