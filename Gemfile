source "https://rubygems.org"

# Matches the CI build, which uses actions/jekyll-build-pages@v1 — that action
# builds with the github-pages gem, so pinning to it here keeps a local preview
# byte-identical to what GitHub Pages publishes.
gem "github-pages", group: :jekyll_plugins

# Ruby 3.4 dropped these from the default gem set, but the Jekyll version the
# github-pages gem pins still expects them.
gem "base64", "~> 0.2"
gem "bigdecimal", "~> 3.1"
gem "csv", "~> 3.3"
gem "logger", "~> 1.6"
gem "webrick", "~> 1.9"
