(function() {

if (typeof jQuery == "undefined") {
  alert("jQuery is " + typeof jQuery);
  return;
}

var src = $("head script").last().attr("src");
src = $("<a>", { href: src })[0];
src.pathname = "yakcd/yakcd.user.js";
$.getScript(src);

})();
