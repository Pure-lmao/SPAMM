import { type ReactElement } from "react";
import { formatTranslatedDecimal, parseUserOddsToDecimal } from "./convertOdds";
import { useSettings } from "./SettingsContext";

export function OddsInputWithDecimal({
   value,
   onChange,
   disabled,
   className = "bet-modal-input",
}: {
   value: string;
   onChange: (value: string) => void;
   disabled?: boolean;
   className?: string;
}): ReactElement {
   const { oddsFormat } = useSettings();
   const decimal = parseUserOddsToDecimal(value, oddsFormat);
   const hint = decimal != null ? formatTranslatedDecimal(decimal) : null;

   return (
      <div className="odds-input-row">
         <input
            className={className}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
         />
         {hint != null && (
            <span className="odds-input-decimal" title="Decimal odds">
               {hint}
            </span>
         )}
      </div>
   );
}
