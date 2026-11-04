// Quick check of the season math against known dates.
import { seasonFor } from "../src/model/season.js";
for (const [d, known] of [["2012-08-06", "Curiosity landing, Ls about 151"], ["2021-02-18", "Perseverance landing, Ls about 5"], ["2024-05-20", "May 2024 storm"], ["2040-03-15", "default"]]) {
  const s = seasonFor(d);
  console.log(d, known, "=> Ls", s.ls.toFixed(1), s.season, "sun", s.sun.toFixed(2), "mean", s.meanC.toFixed(0), "swing", s.swingC.toFixed(0), "rise", s.sunrise.toFixed(2), "set", s.sunset.toFixed(2), "P", s.pressurePa.toFixed(0), "dose", s.doseMsvPerDay.toFixed(2), "high", s.doseHighMsvPerDay.toFixed(2));
}
