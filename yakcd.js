(function() {

var src = $("<a>", { href: $("script").last().attr("src") })[0];
src.pathname = "yakcd/yakcd.user.js";
$.getScript(src);

})();
