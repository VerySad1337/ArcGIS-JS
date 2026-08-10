import { memo } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

// Top-of-sidebar sign-in control, always visible (not tucked inside the
// collapsed ADD LAYER FROM PORTAL panel) so a user can tell at a glance
// whether they're signed in before reaching for a privileged action
// (creating a hosted layer, drawing into one, editing a hosted feature).
// Entirely inactive/hidden when OAuth isn't configured (oauthConfigured
// false), same as every other sign-in-gated control in the app - see
// AuthService.isOAuthConfigured.
function AccountButton({ oauthConfigured, signedInUser, signingIn, onSignIn, onSignOut }) {
  if (!oauthConfigured) return null;

  if (signedInUser) {
    return (
      <div className="account-button account-button-signed-in">
        <Icon name="user" size={16} />
        <span className="account-button-name" title={signedInUser.fullName}>
          {signedInUser.fullName}
        </span>
        <button type="button" className="gis-button-secondary account-button-action" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="account-button">
      <Icon name="user" size={16} />
      <button
        type="button"
        className="gis-button-secondary account-button-action"
        onClick={onSignIn}
        disabled={signingIn}
      >
        {signingIn ? "Signing in…" : "Sign in to ArcGIS"}
      </button>
    </div>
  );
}

AccountButton.propTypes = {
  oauthConfigured: PropTypes.bool,
  signedInUser: PropTypes.shape({
    username: PropTypes.string,
    fullName: PropTypes.string,
    orgId: PropTypes.string,
    thumbnailUrl: PropTypes.string
  }),
  signingIn: PropTypes.bool,
  onSignIn: PropTypes.func,
  onSignOut: PropTypes.func
};

// Memoized: ApplicationShell re-renders on any of its own state changes
// (toast, sidebar, draw state, layer refresh). Every prop this component
// receives from there is either a primitive or a useCallback/useMemo-stabilized
// value, so memo lets those unrelated re-renders stop at this boundary.
export default memo(AccountButton);
