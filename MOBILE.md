# Bands for Days on the App Store

The iPhone and iPad app lives in `mobile/`. It is a small native shell (Capacitor 8) that shows https://bandsfordays.com/app.html
inside the app, so every push to `main` updates the app too; you only go back to Xcode when something *native* changes
(icon, name, permissions, a new Capacitor version). Nothing in `mobile/` is deployed to the website (`.assetsignore`).

What is different inside the app (all handled by `app.html` when `NATIVE` is true):

- Plus is never sold or linked in the app. Apple's rule 3.1.1 says a digital subscription bought inside an app must go
  through Apple's in-app purchase (Apple keeps 15 to 30%). A Plus subscription bought on the website still works in the
  app, and the account panel just says Free or Plus. The upgrade, checkout and Manage billing buttons stay hidden.
  If you ever want to sell Plus inside the app, that is a separate job (StoreKit, usually through RevenueCat, plus
  double-subscription checks). Do it only once the web version earns enough to be worth the cut.
- Every account can delete itself (Apple rule 5.1.1(v)): Delete account in the account panel calls
  `/api/account/delete` (cancels Plus at Stripe) and then the Supabase function in `supabase-delete-account.sql`.
- PDFs and other websites open in Safari, not inside the app (otherwise there is no back button).
- The "Install" card never shows, and the offline service worker still works because the app is limited to
  app-bound domains (`WKAppBoundDomains` in Info.plist).
- Camera and photo permission texts are in `mobile/ios/App/App/Info.plist` (for "Add a photo of your working").

## Before you start (one-off, about a week of waiting for Apple)

1. **Apple Developer Program**: https://developer.apple.com/programs/enroll/ with your Apple ID, A$149 a year.
   Enrol as an individual (you must be 18 or over; otherwise a parent enrols and you are added as a user).
   Approval takes from a day to a week.
2. **Run the SQL** `supabase-delete-account.sql` in Supabase > SQL Editor so Delete account works. Test it with a
   throwaway account on the website first.
3. **Support email**: the privacy page and App Store listing use support@bandsfordays.com. Create it in Cloudflare >
   Email > Email Routing (free: forward it to your Gmail), or change the address in `privacy.html` and `app.html`.
4. **Read `privacy.html`** once; it is written for you but it is your name on it. Apple asks for its URL
   (https://bandsfordays.com/privacy.html).

## On your Mac (first build, about an hour)

1. Install **Xcode** from the Mac App Store (free, 12 GB, needs a fairly recent macOS). Open it once and accept the licence.
   Also install **Node** from https://nodejs.org (the LTS version) and **Git** (Xcode installs it).
2. Get the repo and the packages:
   ```
   git clone https://github.com/TeagleTheEagle/hsc-study.git
   cd hsc-study/mobile
   npm install
   npx cap sync ios
   npx cap open ios
   ```
   `npm install` is needed because the Xcode project reads the Capacitor packages from `mobile/node_modules`.
3. In Xcode, click **App** at the top of the left-hand file list, then the **Signing & Capabilities** tab:
   - Team: pick your Apple Developer team (sign in with your Apple ID under Xcode > Settings > Accounts if it is empty).
   - Bundle Identifier: `com.bandsfordays.app` (already set; keep it, it can never change after the first upload).
   - Leave "Automatically manage signing" ticked. Xcode makes the certificates for you.
4. Plug in your iPhone (or pick a simulator at the top), press the **Run** triangle. The first time your phone asks you to
   trust the developer under Settings > General > VPN & Device Management. The app should open the site, let you
   sign in, mark an answer, and open a PDF in Safari.

## Put it on TestFlight (so classmates can try it)

1. In Xcode choose **Any iOS Device (arm64)** as the destination, then **Product > Archive**.
2. When the Organizer window opens, click **Distribute App > App Store Connect > Upload**, keep the defaults, Upload.
3. Go to https://appstoreconnect.apple.com > **Apps > + New App**: platform iOS, name "Bands for Days", primary language
   English (Australia), bundle id `com.bandsfordays.app`, SKU `bandsfordays-ios`.
4. Under the app's **TestFlight** tab the build appears after 10 to 30 minutes of processing. Add testers under
   Internal Testing (your own Apple ID) or External Testing (a public link you can send to classmates; the first external
   build gets a quick Apple review).

## Submit to the App Store

In App Store Connect, under the app's **App Store** tab, fill in:

- **Screenshots**: take them on an iPhone with a 6.9" or 6.7" screen (iPhone 16 Pro Max / 15 Pro Max, or that simulator in
  Xcode with Cmd+S). Four to six: Today, a flashcard, a marked answer, Progress. iPad screenshots are needed too if the
  app runs on iPad (it does; use the iPad Pro 13" simulator), or untick iPad under General > App Information.
- **Description** (plain, no prices): "Flashcards, spaced reviews, real HSC past papers and AI marking against the
  official marking guidelines, for Business Studies, Biology, Chemistry, Physics, Maths, English, Legal Studies and
  History. Free to study; progress syncs between your phone and the website." Keywords: HSC, study, flashcards, past papers.
- **Support URL**: https://bandsfordays.com (or the privacy page). **Marketing URL**: https://bandsfordays.com.
- **Privacy Policy URL**: https://bandsfordays.com/privacy.html.
- **App Privacy** (the questionnaire): say the app collects data. Tick Email Address (App Functionality, linked to the user),
  User Content (the typed answers and photos, App Functionality, linked), Other User Content for study progress, and
  Product Interaction (streaks and XP, linked). No tracking, no advertising.
- **Age rating**: answer the questions; it comes out 4+.
- **Category**: Education. **Price**: Free. Do not set up in-app purchases.
- **Sign-in information for the reviewer**: Apple's reviewer needs an account that already works. Create a fresh
  account on the website for them (for example reviewer+apple@yourdomain) and type its email and password into the
  App Review Information box in App Store Connect only (never into the repo or a chat).
- **Notes for the reviewer** (paste this): "Bands for Days is an HSC study app. Study is free. The optional Plus
  subscription is not sold or linked in the app; the app only shows whether an account already has it. Accounts can be
  deleted from the account panel at the top of the app. The camera is used only to photograph handwritten working for
  marking; the photo is not stored."
- Export compliance is already answered in Info.plist (`ITSAppUsesNonExemptEncryption` = NO, it only uses HTTPS).

Pick the build, Save, **Add for Review**, Submit. Review usually takes one to three days. The common rejections and what to do:

| Apple says | What it means | Fix |
|---|---|---|
| 4.2 Minimum functionality / "the app is just a website" | They want something a browser tab cannot do | Reply pointing out offline study sets, the camera marking and syncing; if they insist, the next step is bundling the study sets inside the app (Capacitor's normal mode, `webDir` instead of `server.url`), which is a bigger change. |
| 3.1.1 In-app purchase | They found a way to buy Plus in the app | Should not happen (buttons are hidden). Send them a screenshot of the account panel in the app. |
| 5.1.1 Account deletion | Delete account did not work for them | Check `supabase-delete-account.sql` has been run and test it on the website. |
| 2.1 App completeness / crash | Their account or network failed | Check the reviewer account signs in on the website; resubmit. |

## Updating the app later

- Website changes: nothing to do, the app shows the live site.
- Icon, name, permissions, Capacitor update: change the files in `mobile/`, then on the Mac `npm install`,
  `npx cap sync ios`, bump **Version** (for example 1.0.1) and **Build** (any higher number) under App > General in Xcode,
  Archive, Upload, pick the build in App Store Connect, Submit. Every upload needs a higher build number.
- Android later: `npm install @capacitor/android && npx cap add android` in `mobile/`, Android Studio, and a one-off
  US$25 Google Play account. The same `NATIVE` rules in `app.html` apply.

## If the site or Supabase ever moves

`mobile/capacitor.config.json` holds the site address (`server.url`) and `Info.plist` lists the app-bound domains
(bandsfordays.com and the Supabase project host). Change both, sync, and ship a new build.
