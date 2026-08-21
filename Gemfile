source "https://rubygems.org"

# Local preview only. CI publishes the real site with actions/jekyll-build-pages,
# which uses the github-pages gem (Jekyll 3.9.3). That gem cannot run on Ruby 4.x,
# so local development uses current Jekyll instead. The templates here use only
# core Liquid and built-in filters and declare an explicit `permalink` per page,
# so the rendered homepage is the same; if a future template needs a plugin,
# check it against the github-pages gem's allowlist before relying on it.
gem "jekyll", "~> 4.4"

# Dropped from Ruby's default gems; Jekyll and its server still expect them.
gem "base64", "~> 0.2"
gem "bigdecimal", "~> 3.1"
gem "csv", "~> 3.3"
gem "logger", "~> 1.6"
gem "webrick", "~> 1.9"
