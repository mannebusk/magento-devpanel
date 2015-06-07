<?php
/**
 * DevPanel Package.
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Model_Package
    extends Mage_Core_Model_Design_Package
{
    /**
     * Whether theme/skin hierarchy should be checked via fallback mechanism.
     *
     * @return boolean
     */
    public function getShouldFallback()
    {
        return $this->_shouldFallback;
    }

    /**
     * Check for files existence by specified scheme
     *
     * If fallback enabled, the first found file will be returned. Otherwise the
     * base package / default theme file, regardless of found or not.
     *
     * If disabled, the lookup won't be performed to spare filesystem calls.
     *
     * @param  string $file
     * @param  array  &$params
     * @param  array  $fallbackScheme
     *
     * @return string
     */
    protected function _fallback($file, array &$params, array $fallbackScheme = array(array()))
    {
        if ($this->_shouldFallback) {
            foreach ($fallbackScheme as $try) {
                $params = array_merge($params, $try);

                if ($this->validateFile($file, $params)) {
                    return $params['_package'];
                }
            }
            $params['_package'] = self::BASE_PACKAGE;
            $params['_theme']   = self::DEFAULT_THEME;
        }

        return $params['_package'];
    }

    /**
     * Use this one to get existing file name with fallback to default.
     *
     * $params['_type'] is required.
     *
     * @param  string $file
     * @param  array $params
     *
     * @return string
     */
    public function getFilePackage($file, array $params)
    {
        $this->updateParamDefaults($params);

        return $this->_fallback(
            $file,
            $params,
            $this->_fallback->getFallbackScheme(
                $params['_area'],
                $params['_package'],
                $params['_theme']
            )
        );
    }
}
