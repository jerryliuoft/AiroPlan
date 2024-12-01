import { plugin } from "puppeteer-with-fingerprints";
import { readFile, writeFile } from "fs/promises";
import fs from "node:fs";

// Set the service key for the plugin (you can buy it here https://bablosoft.com/directbuy/FingerprintSwitcher/2).
// Leave an empty string to use the free version.
plugin.setServiceKey("");

const MAX_POINTS = 96;
const MIN_MIX_CABIN = 60;
const HIDE_BROWSER = false;
const START_DATE = "2025-01-01";
const END_DATE = "2025-02-16";
const START_AIRPORTS = ["YTO"];
const DESTINATION_AIRPORTS = ["HND", "NRT", "KIX"];
const NUM_PPL = 2;

async function findRandomFingerPrint() {
  let files = await fs.readdirSync("./fingerprints/", {
    withFileTypes: true,
    recursive: false,
  });

  return files[Math.floor(Math.random() * files.length)];
}

async function setup() {
  // USE THIS TO GET NEW FINGREPRINTS
  // Get a fingerprint from the server:
  try {
    const fingerprint = await plugin.fetch({
      tags: ["Microsoft Windows", "Chrome"],
    });
    await writeFile(
      "./fingerprints/" + Date.now() + "-fingerprint.json",
      fingerprint
    );
    // Apply fingerprint:
    plugin.useFingerprint(fingerprint);
  } catch {
    const fingerPrintFile = await findRandomFingerPrint();
    console.log(fingerPrintFile);
    plugin.useFingerprint(
      await readFile("./fingerprints/" + fingerPrintFile.name, "utf8")
    );
  }

  // const fingerPrintFile = await findRandomFingerPrint();
  // console.log(fingerPrintFile);
  // plugin.useFingerprint(
  //   await readFile("./fingerprints/" + fingerPrintFile.name, "utf8")
  // );

  // Launch the browser instance:
  const browser = await plugin.launch({ headless: HIDE_BROWSER });

  // The rest of the code is the same as for a standard `puppeteer` library:
  const page = await browser.newPage();
  return { page, browser };
}

async function checkPage(page) {
  await page.waitForSelector("[aria-label^='Business Class']", {
    timeout: 30_000,
  });
  const businessClassPriceElements = await page.$$(
    "[aria-label^='Business Class']"
  );
  console.log(businessClassPriceElements.length);
  var meetsCriteria = false;
  for (const businessEl of businessClassPriceElements) {
    const price = await businessEl.$eval(
      ".points-total",
      (el) => el.textContent
    );
    // Price is 40k 50k, get rid of the K for comparison
    const numVal = price.split("K")[0];

    if (numVal <= MAX_POINTS) {
      // check if is mix cabin
      const percent = await businessEl
        .$eval(".mixed-cabin-percentage", (el) => {
          return el.textContent.split("%")[0];
        })
        .catch((e) => {
          // NICE! FULL BUSINESS FLIGHT BABY
          return 100;
        });
      if (percent > MIN_MIX_CABIN) {
        console.log("found");
        console.log(percent);
        meetsCriteria = true;
      }
    }
  }
  return meetsCriteria;
}
function getDaysArray(start, end) {
  const arr = [];
  for (
    const dt = new Date(start);
    dt <= new Date(end);
    dt.setDate(dt.getDate() + 1)
  ) {
    arr.push(new Date(dt).toISOString().slice(0, 10));
  }
  return arr;
}

function getSearchUrls(startDate, endDate, orgs, destinations, numPeople = 1) {
  const urls = getDaysArray(startDate, endDate).map((date) => {
    return orgs.map((org) => {
      return destinations.map((dest) => {
        // return `https://www.aircanada.com/aeroplan/redeem/availability/outbound?org0=${org}&dest0=${dest}&departureDate0=${date}&ADT=${numPeople}&YTH=0&CHD=0&INF=0&INS=0&lang=en-CA&tripType=O&marketCode=INT`;
        return `https://www.aircanada.com/aeroplan/redeem/availability/outbound?tripType=O&org0=${org}&dest0=${dest}&departureDate0=${date}&ADT=${numPeople}&YTH=0&CHD=0&INF=0&INS=0`;
      });
    });
  });
  return urls.flat(2);
}

async function screenshot(page) {
  //Get rid of the banner
  await page
    .locator("#mat-dialog-title-0 > span")
    .click()
    .catch((e) => {
      console.log("Sign in page didn't show up");
    });
  // sort business flights
  await page
    .locator(
      "#upsell-header > div.cabins.font-weight-bold.business.ng-star-inserted"
    )
    .click();

  const fileName = Date.now();
  await page.screenshot({
    path: fileName + ".png",
    fullPage: true,
  });
}
async function parseUrls(page, browser, urls) {
  let failedUrls = [];
  let foundUrls = [];
  if (urls.length < 1) {
    return { failedUrls, foundUrls };
  }
  let shouldReset = false;

  // Must use of for iternation in sequence
  for (const url of urls) {
    console.log(url);
    try {
      await page.goto(url);
      const found = await checkPage(page);
      shouldReset = false;
      if (found) {
        foundUrls.push(url);
        await screenshot(page);
      }
    } catch (e) {
      failedUrls.push(url);
      if (shouldReset) {
        await browser.close();
        const browservars = await setup();
        page = browservars.page;
        browser = browservars.browser;
      }
      shouldReset = true; // Only reset browser if we get 2 consecutive empty pages.
    }
  }
  return { failedUrls, foundUrls };
}

async function main() {
  const urls = getSearchUrls(
    START_DATE,
    END_DATE,
    START_AIRPORTS,
    DESTINATION_AIRPORTS,
    NUM_PPL
  );

  // const urls = getSearchUrls(
  //   "2024-12-20",
  //   "2025-01-01",
  //   ["HND", "PVG", "ICN", "NRT", "PEK"],
  //   ["YTO"],
  //   1
  // );
  let { page, browser } = await setup();

  const { failedUrls, foundUrls } = await parseUrls(page, browser, urls);
  console.log("found Urls:");
  console.log(foundUrls);
  // Retry once
  const newResult = await parseUrls(page, browser, failedUrls);

  console.log("Failed Urls:");
  console.log(newResult.failedUrls);
  console.log("Additional Founds:");
  console.log(newResult.foundUrls);

  await browser.close();
}

main();
