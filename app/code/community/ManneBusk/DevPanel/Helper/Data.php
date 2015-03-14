<?php
/**
 * DePanel Core Helper
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Helper_Data extends Mage_Core_Helper_Abstract
{
    /**
     * Get SVG icon image
     *
     * @param string $name
     * @param string $alt
     *
     * @return string
     */
    public function getIcon($name)
    {
        $packageModel   = Mage::getSingleton('core/design_package');
        $area           = 'frontend'; // Force frontend area
        $package        = $packageModel->getPackageName();
        $theme          = $packageModel->getTheme($area);
        $baseDesignDir  = Mage::getBaseDir('app') . DS . 'design' . DS . $area;
        $name = 'devpanel/images/' . $name . '.svg';
        $params = array(
            '_type'     => 'skin',
            '_area'     => $area,
            '_package'  => $package,
            '_theme'    => $theme,
        );
        return file_get_contents($packageModel->getFilename($name, $params));
    }


    /**
     * Get url forced to default frontend store if no store is set
     * 
     * @param string $url 
     * @param array $params 
     *
     * @return string
     */
    public function getFrontUrl($url = "", $params = array())
    {
        $override = array(
            '_store' => Mage::app()->getDefaultStoreView()->getId()
        );

        if (!array_key_exists('_store', $params)) {
            $params = array_merge($params, $override);
        }

        return Mage::getUrl($url, $params);
    }
}
