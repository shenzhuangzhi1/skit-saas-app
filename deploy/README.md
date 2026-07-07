# Skit SaaS App Deployment

The current app repository is a uni-app source project without a stable CLI build script. The GitHub Actions workflow validates the key JSON files and publishes a source bundle to the server:

`$HOME/skit-saas/app-source/current`

After the uni-app CLI build dependencies are added, this workflow can be extended to build and deploy H5, WeChat Mini Program, or native app artifacts.
