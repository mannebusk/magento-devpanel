<?php
/**
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Block_Tab_Store
    extends ManneBusk_DevPanel_Block_Tab
{
    /**
     * Get all websites
     *
     * @return Core_Model_Mysql4_Website_Collection
     */
    public function getWebsites()
    {
        return Mage::getModel('core/website')
            ->getCollection()
            ->addFieldToSelect('*')
            ->addFieldToFilter('code', array('neq' => 'world'));
    }

    /**
     * Retrieve new (not loaded) Store collection object with website filter
     *
     * @return Mage_Core_Model_Mysql4_Store_Collection
     */
    public function getStoreCollection(Mage_Core_Model_Website $website)
    {
        return Mage::getModel('core/store')
            ->getCollection()
            ->addFieldToSelect('*')
            ->addWebsiteFilter($website->getId())
            ->addFieldToFilter('code', array('nlike' => 'charity_%'));
    }

    /**
     * Get configured default country for store
     *
     * @param Mage_Core_Model_Store $store
     *
     * @return Mage_Directory_Model_Country
     */
    public function getDefaultCountry(Mage_Core_Model_Store $store)
    {
        $countryCode = Mage::getStoreConfig('general/country/default', $store->getId());
        return Mage::getModel('directory/country')->loadByCode($countryCode)->getName();
    }
}
