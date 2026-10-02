# Using Personal Tracker on a phone or tablet

The app adapts to the screen it is on:

| Screen | Navigation |
| --- | --- |
| Phone | Bar along the bottom: Home, My Day, **+** (quick add), Jobs, More (all other pages) |
| Tablet held upright | Menu button (top left) slides the full menu in; floating **+** for quick add |
| Tablet on its side / small laptop | Slim icon strip down the left |
| Computer | Full sidebar |

Lists turn into tappable rows on small screens, forms open full screen on phones, and wide tables scroll sideways inside their own card.

## Add to Home Screen (install)

Installing gives the app its own icon, opens it full screen without the browser bars, and is required for phone notifications on iPhone.

- **Android (Chrome / Edge):** a banner appears on the dashboard — tap **Install**. Or avatar menu → **Install app**, or Settings → Account → **Install the app**.
- **iPhone / iPad (Safari):** tap **Share** → **Add to Home Screen** → **Add**. The app shows these steps when you tap Install.
- **Computer (Chrome / Edge):** avatar menu → **Install app**, or the install icon in the address bar.

Long-pressing the installed icon on Android gives shortcuts to My Day, Paste & Import, Scan a receipt and Notifications.

### It needs a secure address

Browsers only allow installing (and phone notifications) from `https://` addresses or from `localhost`.

- On the computer running the app, `http://localhost:5173` works.
- On your phone, the app must be live on an `https://` address (see the hosting options in the README). Until then you can still *use* it on your phone over Wi‑Fi — run `npm run dev:phone` and open the "Network" address it prints — but the Install button and phone notifications won't be offered there. (iPhone's Add to Home Screen still creates an icon, without notifications.)

## Offline

Your data lives on the server, so the app needs a connection to show or save anything. If you open it with no connection you get a clear "Can't reach Personal Tracker" screen with a **Try again** button, and a banner appears if the connection drops while you're using it. Nothing is cached on the device except the app's own files.
