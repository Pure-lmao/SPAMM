import { Route, Routes } from "react-router-dom";
import { type ReactElement } from "react";
import { RootLayout } from "./layout/RootLayout";
import { DemoPage } from "./pages/DemoPage";
import { EventMarketsPage } from "./pages/EventMarketsPage";
import { HomePage } from "./pages/HomePage";
import { MyBetsPage } from "./pages/MyBetsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function AppRoutes(): ReactElement {
   return (
      <Routes>
         <Route element={<RootLayout />}>
            <Route index element={<HomePage />} />
            <Route path="my-bets" element={<MyBetsPage />} />
            <Route path="demo" element={<DemoPage />} />
            <Route path="events/:sportId/:leagueId/:eventId" element={<EventMarketsPage />} />
            <Route path="*" element={<NotFoundPage />} />
         </Route>
      </Routes>
   );
}
